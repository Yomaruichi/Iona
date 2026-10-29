const db = require('../../core/db');
const { notify } = require('../../core/notify');
const { createMonitoringJobs } = require('./monitoring');
const { readChannelIds } = require('./config');
const { createLogger } = require('../../core/logger');
const log = createLogger('youtube');

const apiKey = process.env.YOUTUBE_API_KEY;
const destination = process.env.YOUTUBE_DISCORD_CHANNEL_ID;
const channelIds = readChannelIds(process.env);
const highlightsEnabled = process.env.HIGHLIGHTS_ENABLED === 'true';
const enqueueReplay = highlightsEnabled ? require('../../highlights/store').enqueue : undefined;
const highlightJobs = highlightsEnabled ? [{ schedule: '*/5 * * * *', label: 'highlight-links',
    task: () => require('../../highlights/store').deliverCompleted(notify) }] : [];

// INFO at initialization; channelCount describes configured sources and booleans expose missing credentials safely.
log.info(apiKey && destination ? 'monitoring_enabled' : 'monitoring_disabled', {
    apiKeyConfigured: Boolean(apiKey), destinationConfigured: Boolean(destination), channelCount: channelIds.length, schedule: '0 */1 * * *',
});

module.exports = {
    name: 'youtube',
    cronJobs: apiKey && destination ? [
        ...createMonitoringJobs({ apiKey, destination, channelIds, db, notify, enqueueReplay }), ...highlightJobs,
    ] : [],
};
