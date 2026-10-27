const { isAvailable } = require('./uploads');
const { createLogger, safeError } = require('../../core/logger');
const log = createLogger('youtube-latest');

async function fetchLatestVideo({ apiKey, channelId, fetchImpl = fetch }) {
    async function request(resource, parameters) {
        // INFO before a real API request; resource names the endpoint without exposing the key or URL.
        log.info('request_started', { resource });
        try {
            const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
            url.search = new URLSearchParams({ key: apiKey, ...parameters });
            const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(15000) });
            if (!response.ok) {
                const error = new Error(`YouTube request failed (${response.status})`);
                error.code = `HTTP_${response.status}`;
                throw error;
            }
            const result = await response.json();
            if (!Array.isArray(result.items)) throw new Error(`Invalid YouTube ${resource} response`);
            // INFO after response validation; itemCount is the returned resource count.
            log.info('request_completed', { resource, itemCount: result.items.length });
            return result.items;
        } catch (error) {
            // ERROR for transport or API failure; the manual test stops without a dummy message.
            log.error('request_failed', { resource, ...safeError(error), nextAction: 'abort_test' });
            throw error;
        }
    }

    const channels = await request('channels', { part: 'contentDetails', id: channelId });
    const playlistId = channels.find(channel => channel.id === channelId)?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlistId) throw new Error('YouTube channel has no accessible uploads playlist');
    const uploads = await request('playlistItems', { part: 'contentDetails', playlistId, maxResults: '50' });
    const ids = [...new Set(uploads.map(item => item.contentDetails?.videoId)
        .filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id)))];
    if (!ids.length) {
        // INFO for an empty uploads playlist; no metadata request or notification is needed.
        log.info('selection_skipped', { reason: 'no_uploads' });
        return null;
    }
    const videos = await request('videos', { part: 'snippet,status,liveStreamingDetails', id: ids.join(',') });
    const available = videos.filter(video => ids.includes(video.id) && video.snippet?.channelId === channelId && isAvailable(video));
    const availableAt = video => Date.parse(video.liveStreamingDetails?.actualEndTime || video.snippet.publishedAt) || 0;
    available.sort((left, right) => availableAt(right) - availableAt(left));
    const latest = available[0] || null;
    // INFO after filtering; counts explain exclusions and videoId identifies the selected upload/replay.
    log.info(latest ? 'video_selected' : 'selection_skipped', {
        candidates: ids.length, available: available.length, videoId: latest?.id || null,
    });
    return latest;
}

module.exports = { fetchLatestVideo };
