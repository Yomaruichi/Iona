const { createLogger, safeError } = require('../../core/logger');
const { playlistVideoIds } = require('./videos');

function validateResponse(response) {
    if (response.ok) return;
    const error = new Error(`YouTube request failed (${response.status})`);
    error.code = `HTTP_${response.status}`;
    throw error;
}

function uploadsPlaylist(channel) {
    const playlist = channel?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlist) throw new Error('YouTube channel has no accessible uploads playlist');
    return playlist;
}

class YouTubeApi {
    constructor({ apiKey, fetchImpl = fetch, logger = createLogger('youtube') }) {
        this.apiKey = apiKey;
        this.fetch = fetchImpl;
        this.log = logger;
        this.requests = 0;
    }

    async request(url, format, resource) {
        try {
            // DEBUG before transport; resource is a safe endpoint label, not a credential-bearing URL.
            this.log.debug('transport_started', { resource });
            const response = await this.fetch(url, { signal: AbortSignal.timeout(15000) });
            validateResponse(response);
            const result = await response[format]();
            // DEBUG after decoding; status describes HTTP completion, not valid application data.
            this.log.debug('transport_completed', { resource, status: response.status });
            return result;
        } catch (error) {
            // ERROR on transport/decoding failure; the caller aborts its check or manual test.
            this.log.error('request_failed', { resource, ...safeError(error), nextAction: 'abort_operation' });
            throw error;
        }
    }

    async list(resource, parameters) {
        this.requests++;
        // INFO before each API attempt; apiRequests is the count within the current check/client.
        this.log.info('api_request_started', { resource, apiRequests: this.requests });
        const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
        url.search = new URLSearchParams({ key: this.apiKey, ...parameters });
        const result = await this.request(url.toString(), 'json', resource);
        if (!Array.isArray(result.items)) throw new Error(`Invalid YouTube ${resource} response`);
        // INFO after response validation; itemCount records the number of returned API resources.
        this.log.info('api_request_completed', { resource, itemCount: result.items.length });
        return result.items;
    }

    feed(channelId) {
        const url = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
        return this.request(url, 'text', 'feed');
    }

    async playlist(channelId) {
        const channels = await this.list('channels', { part: 'contentDetails', id: channelId });
        return uploadsPlaylist(channels.find(channel => channel.id === channelId));
    }

    async uploads(playlistId) {
        const items = await this.list('playlistItems', { part: 'contentDetails', playlistId, maxResults: '50' });
        return playlistVideoIds(items);
    }

    async videos(ids) {
        const videos = [];
        for (let offset = 0; offset < ids.length; offset += 50) {
            const items = await this.list('videos', {
                part: 'snippet,status,liveStreamingDetails', id: ids.slice(offset, offset + 50).join(','),
            });
            videos.push(...items);
        }
        return videos;
    }
}

module.exports = { YouTubeApi };
