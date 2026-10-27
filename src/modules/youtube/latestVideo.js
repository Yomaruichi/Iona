const { YouTubeApi } = require('./api');
const { belongsToChannel, availableAt } = require('./videos');
const { createLogger } = require('../../core/logger');
const log = createLogger('youtube-latest');

function newestAvailable(videos, ids, channelId) {
    const available = videos.filter(video => ids.includes(video.id) && belongsToChannel(video, channelId));
    available.sort((left, right) => availableAt(right) - availableAt(left));
    const latest = available[0] || null;
    // INFO after filtering; counts explain exclusions and videoId identifies the selected upload/replay.
    log.info(latest ? 'video_selected' : 'selection_skipped', {
        candidates: ids.length, available: available.length, videoId: latest?.id || null,
    });
    return latest;
}

async function fetchLatestVideo({ apiKey, channelId, fetchImpl }) {
    const api = new YouTubeApi({ apiKey, fetchImpl, logger: log });
    const playlistId = await api.playlist(channelId);
    const ids = await api.uploads(playlistId);
    if (!ids.length) {
        // INFO when no uploads exist; metadata lookup and notification are unnecessary.
        log.info('selection_skipped', { reason: 'no_uploads' });
        return null;
    }
    const videos = await api.videos(ids);
    return newestAvailable(videos, ids, channelId);
}

module.exports = { fetchLatestVideo };
