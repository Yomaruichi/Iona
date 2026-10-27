require('dotenv').config();
const db = require('../core/db');
const { createUploadChecker } = require('../modules/youtube/uploads');
const { createLogger, safeError } = require('../core/logger');
const log = createLogger('youtube-diagnostic');
const { selectChannel } = require('../modules/youtube/config');

async function main() {
    // INFO at tool startup; this run uses real requests but performs no writes or sends.
    log.info('started', { mode: 'read_only' });
    if (!process.env.YOUTUBE_API_KEY || !process.env.YOUTUBE_DISCORD_CHANNEL_ID) {
        throw new Error('YOUTUBE_API_KEY and YOUTUBE_DISCORD_CHANNEL_ID are required');
    }
    const channelId = selectChannel(process.env, process.argv[2]);
    // INFO after channel selection; channelId identifies which configured source the read-only check will inspect.
    log.info('channel_selected', { channelId });
    await db.connect();
    const check = createUploadChecker({
        apiKey: process.env.YOUTUBE_API_KEY,
        channelId,
        destination: process.env.YOUTUBE_DISCORD_CHANNEL_ID,
        // Inspect production state without altering it or announcing historical videos.
        db: {
            getState: db.getState,
            setState: async (_module, _key, value) => {
                // INFO for an intercepted write; counts describe proposed state without persisting it.
                log.info('state_write_simulated', { seen: value.seen.length, pending: value.pending.length });
            },
        },
        notify: async (_channel, message) => {
            // INFO for an intercepted delivery; notification contents and links are deliberately omitted.
            log.info('delivery_simulated', { channelId: process.env.YOUTUBE_DISCORD_CHANNEL_ID });
        },
    });
    await check();
    // INFO only after the diagnostic completes without real writes or messages.
    log.info('completed', { databaseWrites: 0, discordMessages: 0 });
}

main().catch(error => {
    // ERROR for a failed one-off diagnostic; the tool exits nonzero and the service is unaffected.
    log.error('failed', { ...safeError(error), nextAction: 'exit_tool' });
    process.exitCode = 1;
}).finally(() => db.mongoose.disconnect());
