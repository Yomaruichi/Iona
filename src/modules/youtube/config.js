const DEFAULT_CHANNEL_ID = 'UCcHHkJ98eSfa5aj0mdTwwLQ';

function readChannelIds(env) {
    const configured = env.YOUTUBE_CHANNEL_IDS || env.YOUTUBE_CHANNEL_ID || DEFAULT_CHANNEL_ID;
    const channelIds = [...new Set(configured.split(',').map(id => id.trim()).filter(Boolean))];
    if (!channelIds.length) {
        const error = new Error('YouTube channel configuration must contain at least one channel ID');
        error.code = 'INVALID_CHANNEL_CONFIGURATION';
        throw error;
    }
    return channelIds;
}

function selectChannel(env, requested) {
    const channelIds = readChannelIds(env);
    if (!requested) return channelIds[0];
    if (channelIds.includes(requested)) return requested;
    const error = new Error('Requested YouTube channel is not in the configured channel list');
    error.code = 'CHANNEL_NOT_CONFIGURED';
    throw error;
}

module.exports = { readChannelIds, selectChannel };
