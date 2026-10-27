require('dotenv').config();
const { once } = require('node:events');
const { Client, GatewayIntentBits } = require('discord.js');
const notifications = require('../core/notify');
const { createUploadChecker } = require('../modules/youtube/uploads');
const { createLogger, safeError } = require('../core/logger');
const log = createLogger('youtube-simulation');

async function main() {
    // INFO when simulation begins; only Discord delivery is real.
    log.info('started', { mode: 'fake_youtube_real_discord' });
    const destination = process.env.YOUTUBE_DISCORD_CHANNEL_ID;
    if (!process.env.DISCORD_TOKEN || !destination) {
        throw new Error('DISCORD_TOKEN and YOUTUBE_DISCORD_CHANNEL_ID are required');
    }
    const channelId = process.env.YOUTUBE_CHANNEL_ID || 'UCcHHkJ98eSfa5aj0mdTwwLQ';
    const videoId = 'SIMULATED01';
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const loginTimeout = setTimeout(() => {
        // ERROR after the login deadline; the temporary client is destroyed and the tool exits nonzero.
        log.error('login_timeout', { timeoutMs: 30000, nextAction: 'exit_tool' });
        client.destroy();
        process.exitCode = 1;
    }, 30000);
    try {
        const ready = once(client, 'clientReady');
        // INFO before Discord login; credentials are excluded.
        log.info('login_started');
        await client.login(process.env.DISCORD_TOKEN);
        await ready;
        clearTimeout(loginTimeout);
        // INFO once the simulation client has received the gateway ready event.
        log.info('discord_ready');
        notifications.init(client);

        // Use an initialized, empty in-memory store to simulate a newly discovered upload.
        const db = { getState: async () => ({ initialized: true, seen: [], pending: [] }), setState: async () => {} };
        const check = createUploadChecker({
            apiKey: 'simulation-only', destination, channelId, db,
            notify: (channel, message) => notifications.notify(channel, {
                ...message,
                body: 'This is a simulated upload notification. No new video was detected.',
                url: `https://www.youtube.com/channel/${channelId}`,
            }),
            fetchImpl: async url => url.includes('/xml/feeds/') ? {
                ok: true,
                text: async () => `<feed><yt:videoId>${videoId}</yt:videoId></feed>`,
            } : {
                ok: true,
                json: async () => ({ items: [{
                    id: videoId,
                    snippet: {
                        channelId, title: '[TEST] Simulated YouTube upload',
                        publishedAt: new Date().toISOString(), liveBroadcastContent: 'none',
                    },
                    status: { privacyStatus: 'public', uploadStatus: 'processed' },
                }] }),
            },
        });
        await check();
        // INFO after the real notification succeeds; destination identifies where to verify the test embed.
        log.info('completed', { channelId: destination });
    } finally {
        clearTimeout(loginTimeout);
        client.destroy();
        // INFO after disposing the temporary client; the main bot process is independent.
        log.info('client_closed');
    }
}

main().catch(error => {
    // ERROR for a failed simulation; classifications omit secrets and the tool exits nonzero.
    log.error('failed', { ...safeError(error), nextAction: 'exit_tool' });
    process.exitCode = 1;
});
