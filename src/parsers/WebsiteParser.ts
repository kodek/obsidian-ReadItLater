import { App, Notice, Platform, request } from 'obsidian';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import * as DOMPurify from 'isomorphic-dompurify';
import TemplateEngine from 'src/template/TemplateEngine';
import { formatDate, getBaseUrl, normalizeFilename, replaceImages } from '../helpers';
import { ReadItLaterSettings } from '../settings';
import { Note } from './Note';
import { Parser } from './Parser';
import { parseHtmlContent } from './parsehtml';

interface ReadabilityArticle {
    title: string;
    content: string;
    textContent: string;
    length: number;
    excerpt: string;
    byline: string;
    dir: string;
    siteName: string;
    lang: string;
    publishedTime: string;
}

interface WebsiteNoteData {
    date: string;
    articleTitle: string;
    articleURL: string;
    articleReadingTime: number;
    articleContent: string;
    siteName: string;
    author: string;
    previewURL: string;
    publishedTime: string;
    readabilityArticle: ReadabilityArticle;
}

class WebsiteParser extends Parser {
    constructor(app: App, settings: ReadItLaterSettings, templateEngine: TemplateEngine) {
        super(app, settings, templateEngine);
    }

    test(url: string): boolean {
        return this.isValidUrl(url);
    }

    async prepareNote(url: string): Promise<Note> {
        const originUrl = new URL(url);
        const document = await this.getDocument(originUrl);

        return this.makeNote(document, originUrl);
    }

    protected async makeNote(document: Document, originUrl: URL): Promise<Note> {
        if (!isProbablyReaderable(document)) {
            new Notice('@mozilla/readability considers this document to unlikely be readerable.');
        }

        const previewUrl = this.extractPreviewUrl(document);
        const readableDocument = new Readability(document).parse();

        if (readableDocument === null || !Object.prototype.hasOwnProperty.call(readableDocument, 'content')) {
            return this.notParsableArticle(originUrl.href, previewUrl);
        }

        const content = await parseHtmlContent(readableDocument.content);

        return this.parsableArticle({
            date: this.getFormattedDateForContent(),
            articleTitle: readableDocument.title || 'No title',
            articleURL: originUrl.href,
            articleReadingTime: this.getEstimatedReadingTime(readableDocument),
            articleContent: content,
            siteName: readableDocument.siteName || '',
            author: readableDocument.byline || '',
            previewURL: previewUrl || '',
            publishedTime:
                readableDocument.publishedTime !== null
                    ? formatDate(readableDocument.publishedTime, this.settings.dateContentFmt)
                    : '',
            readabilityArticle: readableDocument,
        });
    }

    protected async getDocument(url: URL): Promise<Document> {
        const response = await request({ method: 'GET', url: url.href });
        const document = new DOMParser().parseFromString(response, 'text/html');

        //check for existing base element
        const originBasElements = document.getElementsByTagName('base');
        let originBaseUrl = null;
        if (originBasElements.length > 0) {
            originBaseUrl = originBasElements.item(0).getAttribute('href');
            Array.from(originBasElements).forEach((originBasEl) => {
                originBasEl.remove();
            });
        }

        // Set base to allow Readability to resolve relative path's
        const baseEl = document.createElement('base');
        baseEl.setAttribute('href', getBaseUrl(originBaseUrl ?? url.href, url.origin));
        document.head.append(baseEl);
        const cleanDocumentBody = DOMPurify.sanitize(document.body.innerHTML);
        document.body.innerHTML = cleanDocumentBody;

        /*
        DOM optimizations from MarkDownload. Distributed under an Apache License 2.0: https://github.com/deathau/markdownload/blob/main/LICENSE
        */
        document.body.querySelectorAll('pre br')?.forEach((br) => {
            // we need to keep <br> tags because they are removed by Readability.js
            br.outerHTML = '<br-keep></br-keep>';
        });

        document.body.querySelectorAll('h1, h2, h3, h4, h5, h6')?.forEach((header) => {
            // Readability.js will strip out headings from the dom if certain words appear in their className
            // See: https://github.com/mozilla/readability/issues/807
            header.className = '';
        });

        document.body.querySelectorAll('[class*=highlight-text],[class*=highlight-source]')?.forEach((codeSource) => {
            const language = codeSource.className.match(/highlight-(?:text|source)-([a-z0-9]+)/)?.[1];
            if (codeSource.firstElementChild.nodeName == 'PRE') {
                codeSource.removeAttribute('data-snippet-clipboard-copy-content');
                codeSource.firstElementChild.id = `code-lang-${language}`;
            }
        });

        document.body.querySelectorAll('[class*=language-]')?.forEach((codeSource) => {
            const language = codeSource.className.match(/language-([a-z0-9]+)/)?.[1];
            codeSource.id = `code-lang-${language}`;
        });

        document.body.querySelectorAll('.codehilite > pre')?.forEach((codeSource) => {
            if (codeSource.firstChild.nodeName !== 'CODE' && !codeSource.className.includes('language')) {
                codeSource.id = 'code-lang-text';
            }
        });

        return document;
    }

    protected async parsableArticle(data: WebsiteNoteData): Promise<Note> {
        const fileNameTemplate = this.templateEngine.render(this.settings.parseableArticleNoteTitle, {
            title: data.articleTitle,
            date: this.getFormattedDateForFilename(),
        });

        let processedContent = this.templateEngine.render(this.settings.parsableArticleNote, data);

        if (this.settings.downloadImages && Platform.isDesktop) {
            processedContent = await this.replaceImages(fileNameTemplate, processedContent);
        }

        return new Note(`${fileNameTemplate}.md`, processedContent);
    }

    protected async notParsableArticle(url: string, previewUrl: string | null): Promise<Note> {
        console.error('Website not parseable');

        let content = this.settings.notParsableArticleNote
            .replace(/%articleURL%/g, () => url)
            .replace(/%previewURL%/g, () => previewUrl || '');

        const fileNameTemplate = this.settings.notParseableArticleNoteTitle.replace(
            /%date%/g,
            this.getFormattedDateForFilename(),
        );

        if (this.settings.downloadImages && Platform.isDesktop) {
            content = await this.replaceImages(fileNameTemplate, content);
        }

        return new Note(`${fileNameTemplate}.md`, content);
    }

    /**
     * Extracts a preview URL from the document.
     * Searches for OpenGraph `og:image` and Twitter `twitter:image` meta tags.
     * @param document The document to extract preview URL from
     */
    protected extractPreviewUrl(document: Document): string | null {
        let previewMetaElement = document.querySelector('meta[property="og:image"]');
        if (previewMetaElement == null) {
            previewMetaElement = document.querySelector('meta[name="twitter:image"]');
        }
        return previewMetaElement?.getAttribute('content');
    }

    /**
     * Replaces distant images by their locally downloaded counterparts.
     * @param noteName The note name
     * @param content The note content
     */
    protected async replaceImages(noteName: string, content: string): Promise<string> {
        const assetsDir = this.settings.downloadImagesInArticleDir
            ? `${this.settings.assetsDir}/${normalizeFilename(noteName)}/`
            : this.settings.assetsDir;
        return replaceImages(this.app, content, assetsDir);
    }

    /**
     * Returns estimated reading time of article in minutes
     */
    private getEstimatedReadingTime(article: ReadabilityArticle): number {
        const readingSpeed = this.getReadingSpeed(article.lang || 'en');
        const words = article.textContent.trim().split(/\s+/).length;

        return Math.ceil(words / readingSpeed);
    }

    /**
     * Reading speed in words per minute. Data are gathered from this study https://irisreading.com/average-reading-speed-in-various-languages/
     */
    private getReadingSpeed(lang: string): number {
        const readingSpeed = new Map([
            ['en', 228],
            ['ar', 138],
            ['de', 179],
            ['es', 218],
            ['fi', 161],
            ['fr', 195],
            ['he', 187],
            ['it', 188],
            ['ja', 193],
            ['nl', 202],
            ['pl', 166],
            ['pt', 181],
            ['ru', 184],
            ['sk', 190],
            ['sl', 180],
            ['sv', 199],
            ['tr', 166],
            ['zh', 158],
        ]);

        return readingSpeed.get(lang) || readingSpeed.get('en');
    }
}

export default WebsiteParser;
