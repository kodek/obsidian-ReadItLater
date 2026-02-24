import { requestUrl } from 'obsidian';
import { handleError } from 'src/helpers/error';
import { Note } from './Note';
import { Parser } from './Parser';

interface Schema {
    '@type': string;
}

interface Person extends Schema {
    name?: string;
    url?: string;
}

interface VideoObject extends Schema {
    author?: Person;
    embedUrl?: string;
    name?: string;
    url?: string;
}

interface VimeoNoteData {
    date: string;
    videoId: string;
    videoTitle: string;
    videoURL: string;
    videoPlayer: string;
    channelName: string;
    channelURL: string;
}

class VimeoParser extends Parser {
    private PATTERN = /(vimeo.com)\/(\d+)?/;

    test(clipboardContent: string): boolean | Promise<boolean> {
        return this.isValidUrl(clipboardContent) && this.PATTERN.test(clipboardContent);
    }

    async prepareNote(clipboardContent: string): Promise<Note> {
        const createdAt = new Date();
        const data = await this.parseSchema(clipboardContent, createdAt);

        const content = this.templateEngine.render(this.plugin.settings.vimeoNote, data);

        const fileNameTemplate = this.templateEngine.render(this.plugin.settings.vimeoNoteTitle, {
            title: data.videoTitle,
            date: this.getFormattedDateForFilename(createdAt),
        });

        return new Note(fileNameTemplate, 'md', content, this.plugin.settings.vimeoContentTypeSlug, createdAt);
    }

    private async parseSchema(url: string, createdAt: Date): Promise<VimeoNoteData> {
        try {
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
            const schemaElement = videoHTML.querySelector('script[type="application/ld+json"]');

            if (!schemaElement) {
                throw new Error('Vimeo ld+json schema element not found');
            }

            const schema: [VideoObject, Schema] = JSON.parse(schemaElement.textContent);
            const videoSchema = schema[0];
            const videoIdRegexExec = this.PATTERN.exec(url);

            return {
                date: this.getFormattedDateForContent(createdAt),
                videoId: videoIdRegexExec.length === 3 ? videoIdRegexExec[2] : '',
                videoURL: videoSchema?.url ?? '',
                videoTitle: videoSchema?.name ?? '',
                videoPlayer: `<iframe width="${this.plugin.settings.vimeoEmbedWidth}" height="${this.plugin.settings.vimeoEmbedHeight}" src="${videoSchema?.embedUrl}" title="Vimeo video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
                channelName: videoSchema?.author?.name ?? '',
                channelURL: videoSchema?.author?.url ?? '',
            };
        } catch (error) {
            handleError(error, 'Unable to parse Vimeo page.');
        }
    }
}

export default VimeoParser;
