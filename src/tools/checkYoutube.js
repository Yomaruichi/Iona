require('dotenv').config();
const db = require('../core/db');
const { createUploadChecker } = require('../modules/youtube/uploads');

async function main() {
    if (!process.env.YOUTUBE_API_KEY || !process.env.YOUTUBE_DISCORD_CHANNEL_ID) {
        throw new Error('YOUTUBE_API_KEY and YOUTUBE_DISCORD_CHANNEL_ID are required');
    }
    await db.connect();
    const check = createUploadChecker({
        apiKey: process.env.YOUTUBE_API_KEY,
        channelId: process.env.YOUTUBE_CHANNEL_ID || 'UCcHHkJ98eSfa5aj0mdTwwLQ',
        destination: process.env.YOUTUBE_DISCORD_CHANNEL_ID,
        // Inspect production state without altering it or announcing historical videos.
        db: {
            getState: db.getState,
            setState: async (_module, _key, value) => {
                console.log(`[youtube diagnostic] Would save seen=${value.seen.length}, pending=${value.pending.length}`);
            },
        },
        notify: async (_channel, message) => {
            console.log(`[youtube diagnostic] Would notify: ${message.url}`);
        },
    });
    await check();
    console.log('[youtube diagnostic] Complete. No database writes or Discord messages were made.');
}

main().catch(error => {
    console.error('[youtube diagnostic] Failed:', error.cause?.code || error.message);
    process.exitCode = 1;
}).finally(() => db.mongoose.disconnect());
