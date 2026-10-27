const db = require('../../core/db');
const { notify } = require('../../core/notify');
const { createUploadChecker } = require('./uploads');
const { createLogger } = require('../../core/logger');
const log = createLogger('youtube');

const apiKey = process.env.YOUTUBE_API_KEY;
const destination = process.env.YOUTUBE_DISCORD_CHANNEL_ID;
const channelId = process.env.YOUTUBE_CHANNEL_ID || 'UCcHHkJ98eSfa5aj0mdTwwLQ';

// INFO at module initialization; booleans expose missing configuration without printing key values.
log.info(apiKey && destination ? 'monitoring_enabled' : 'monitoring_disabled', {
    apiKeyConfigured: Boolean(apiKey), destinationConfigured: Boolean(destination), schedule: '0 */1 * * *',
});

module.exports = {
    name: 'youtube',
    cronJobs: apiKey && destination ? [{
        schedule: '0 */1 * * *',
        label: 'uploads',
        task: createUploadChecker({ apiKey, destination, channelId, db, notify }),
    }] : [],
};
