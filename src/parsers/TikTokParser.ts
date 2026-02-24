import { requestUrl } from 'obsidian';
import { handleError } from 'src/helpers/error';
import { Note } from './Note';
import { Parser } from './Parser';

interface TiktokNoteData {
    date: string;
    videoId: string;
    videoURL: string;
    videoDescription: string;
    videoPlayer: string;
    authorName: string;
    authorURL: string;
}

class TikTokParser extends Parser {
    private PATTERN = /(tiktok.com)\/(\S+)\/(video)\/(\d+)/;

    test(clipboardContent: string): boolean | Promise<boolean> {
        return this.isValidUrl(clipboardContent) && this.PATTERN.test(clipboardContent);
    }

    async prepareNote(clipboardContent: string): Promise<Note> {
        const createdAt = new Date();
        let data: TiktokNoteData;
        try {
            data = await this.parseHtml(clipboardContent, createdAt);
        } catch (error) {
            handleError(error, 'Unable to parse TikTok page.');
        }

        const content = this.templateEngine.render(this.plugin.settings.tikTokNote, data);

        const fileNameTemplate = this.templateEngine.render(this.plugin.settings.tikTokNoteTitle, {
            authorName: data.authorName,
            date: this.getFormattedDateForFilename(createdAt),
        });

        return new Note(fileNameTemplate, 'md', content, this.plugin.settings.tikTokContentTypeSlug, createdAt);
    }

    private async parseHtml(url: string, createdAt: Date): Promise<TiktokNoteData> {
        const response = await requestUrl({
            method: 'GET',
            url,
            headers: {
                'user-agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            },
        });

        if (response.status === 429) {
            throw new Error('Rate limited (HTTP 429). Try again later.');
        }
        if (response.status >= 400) {
            throw new Error(`HTTP ${response.status} error fetching ${url}`);
        }

        const html = new TextDecoder().decode(response.arrayBuffer);
        const videoHTML = new DOMParser().parseFromString(html, 'text/html');
        const videoRegexExec = this.PATTERN.exec(url);

        return {
            date: this.getFormattedDateForContent(createdAt),
            videoId: videoRegexExec[4],
            videoURL: videoHTML.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? url,
            videoDescription: videoHTML.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
            videoPlayer: `<iframe width="${this.plugin.settings.tikTokEmbedWidth}" height="${this.plugin.settings.tikTokEmbedHeight}" src="https://www.tiktok.com/embed/v2/${videoRegexExec[4]}"></iframe>`,
            authorName: videoRegexExec[2],
            authorURL: `https://www.tiktok.com/${videoRegexExec[2]}`,
        };
    }
}

export default TikTokParser;
