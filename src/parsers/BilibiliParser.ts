import { requestUrl } from 'obsidian';
import { handleError } from 'src/helpers/error';
import { Note } from './Note';
import { Parser } from './Parser';

interface BilibiliNoteData {
    date: string;
    videoId: string;
    videoTitle: string;
    videoURL: string;
    videoPlayer: string;
}

class BilibiliParser extends Parser {
    private PATTERN = /(bilibili.com)\/(video)?\/([a-z0-9]+)?/i;

    test(url: string): boolean {
        return this.isValidUrl(url) && this.PATTERN.test(url);
    }

    async prepareNote(url: string): Promise<Note> {
        const createdAt = new Date();
        let data: BilibiliNoteData;
        try {
            data = await this.getNoteData(url, createdAt);
        } catch (error) {
            handleError(error, 'Unable to parse Bilibili page.');
        }

        const content = this.templateEngine.render(this.plugin.settings.bilibiliNote, data);

        const fileNameTemplate = this.templateEngine.render(this.plugin.settings.bilibiliNoteTitle, {
            title: data.videoTitle,
            date: this.getFormattedDateForFilename(createdAt),
        });

        return new Note(fileNameTemplate, 'md', content, this.plugin.settings.bilibiliContentTypeSlug, createdAt);
    }

    private async getNoteData(url: string, createdAt: Date): Promise<BilibiliNoteData> {
        const response = await requestUrl({
            method: 'GET',
            url,
            headers: {
                'user-agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36',
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
        const videoId = this.PATTERN.exec(url)[3] ?? '';

        return {
            date: this.getFormattedDateForContent(createdAt),
            videoId: videoId,
            videoTitle: videoHTML.querySelector("[property~='og:title']")?.getAttribute('content') ?? '',
            videoURL: url,
            videoPlayer: `<iframe width="${this.plugin.settings.bilibiliEmbedWidth}" height="${this.plugin.settings.bilibiliEmbedHeight}" src="https://player.bilibili.com/player.html?autoplay=0&bvid=${videoId}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`,
        };
    }
}

export default BilibiliParser;
