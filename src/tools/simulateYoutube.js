const { once } = require('node:events');
const { Client, GatewayIntentBits } = require('discord.js');
const notifications = require('../core/notify');
const { fetchLatestVideo } = require('../modules/youtube/latestVideo');
const { createLogger, safeError } = require('../core/logger');
const log = createLogger('youtube-simulation');

function readConfiguration(env) {
    const required = ['DISCORD_TOKEN', 'YOUTUBE_DISCORD_CHANNEL_ID', 'YOUTUBE_API_KEY'];
    const missing = required.filter(name => !env[name]);
    if (missing.length) {
        const error = new Error(`Missing required configuration: ${missing.join(', ')}`);
        error.code = 'MISSING_CONFIGURATION';
        throw error;
    }
    return {
        token: env.DISCORD_TOKEN,
        destination: env.YOUTUBE_DISCORD_CHANNEL_ID,
        apiKey: env.YOUTUBE_API_KEY,
        channelId: env.YOUTUBE_CHANNEL_ID || 'UCcHHkJ98eSfa5aj0mdTwwLQ',
    };
}

async function sendLatestVideoTest({ apiKey, destination, channelId, fetchImpl = fetch, notify = notifications.notify }) {
    const video = await fetchLatestVideo({ apiKey, channelId, fetchImpl });
    if (!video) {
        // WARN when the recent uploads contain no processed public upload or finished replay.
        log.warn('delivery_skipped', { reason: 'no_available_video', nextAction: 'exit_without_message' });
        return null;
    }
    await notify(destination, {
        title: `[TEST] ${video.snippet.title}`.slice(0, 256),
        body: `Manual notification test using the latest available ${video.liveStreamingDetails ? 'stream replay' : 'upload'}. This is not a new-upload alert.`,
        url: `https://www.youtube.com/watch?v=${video.id}`,
    });
    // INFO only after notification delivery; IDs identify the video and Discord destination.
    log.info('completed', { videoId: video.id, channelId: destination });
    return video;
}

async function main() {
    require('dotenv').config();
    // INFO at test startup; YouTube requests and Discord delivery are real, with no state writes.
    log.info('started', { mode: 'real_youtube_real_discord', databaseWrites: 0 });
    const { token, destination, apiKey, channelId } = readConfiguration(process.env);
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    let timeout;
    try {
        const ready = once(client, 'clientReady');
        const deadline = new Promise((_resolve, reject) => {
            timeout = setTimeout(() => {
                const error = new Error('Discord login timed out');
                error.code = 'LOGIN_TIMEOUT';
                reject(error);
            }, 30000);
        });
        // INFO before Discord login; the token is deliberately excluded.
        log.info('login_started');
        await Promise.race([Promise.all([client.login(token), ready]), deadline]);
        clearTimeout(timeout);
        // INFO after gateway readiness; live API discovery can now proceed.
        log.info('discord_ready');
        notifications.init(client);
        await sendLatestVideoTest({ apiKey, destination, channelId });
    } finally {
        clearTimeout(timeout);
        client.destroy();
        // INFO after disposing the one-off client; the main bot is unaffected.
        log.info('client_closed');
    }
}

if (require.main === module) {
    main().catch(error => {
        // ERROR on manual test failure; exit nonzero without raw credential-bearing errors.
        log.error('failed', { ...safeError(error), nextAction: 'exit_tool' });
        process.exitCode = 1;
    });
}

module.exports = { sendLatestVideoTest, readConfiguration };
