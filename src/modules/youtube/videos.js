function isAvailable(video) {
    if (video.status?.privacyStatus !== 'public') return false;
    if (video.status?.uploadStatus !== 'processed') return false;
    if (['live', 'upcoming'].includes(video.snippet?.liveBroadcastContent)) return false;
    return !video.liveStreamingDetails || Boolean(video.liveStreamingDetails.actualEndTime);
}

function belongsToChannel(video, channelId) {
    return video.snippet?.channelId === channelId && isAvailable(video);
}

function availableAt(video) {
    return Date.parse(video.liveStreamingDetails?.actualEndTime || video.snippet.publishedAt) || 0;
}

function isVideoId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

function playlistVideoIds(items) {
    return [...new Set(items.map(item => item.contentDetails?.videoId).filter(isVideoId))];
}

function parseVideoIds(xml) {
    if (!/<feed(?:\s|>)/.test(xml) || !xml.includes('</feed>')) throw new Error('Invalid YouTube feed');
    const matches = [...xml.matchAll(/<yt:videoId>\s*([A-Za-z0-9_-]{11})\s*<\/yt:videoId>/g)];
    return [...new Set(matches.map(match => match[1]))];
}

module.exports = { isAvailable, belongsToChannel, availableAt, playlistVideoIds, parseVideoIds };
