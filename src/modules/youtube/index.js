const db = require('../../core/db');
const { notify } = require('../../core/notify');
const { createUploadChecker } = require('./uploads');

const apiKey = process.env.YOUTUBE_API_KEY;
const destination = process.env.YOUTUBE_DISCORD_CHANNEL_ID;
const channelId = process.env.YOUTUBE_CHANNEL_ID || 'UCcHHkJ98eSfa5aj0mdTwwLQ';

module.exports = {
    name: 'youtube',
    cronJobs: apiKey && destination ? [{
        schedule: '0 */1 * * *',
        label: 'uploads',
        task: createUploadChecker({ apiKey, destination, channelId, db, notify }),
    }] : [],
};
