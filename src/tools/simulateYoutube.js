require('dotenv').config();
const { once } = require('node:events');
const { Client, GatewayIntentBits } = require('discord.js');
const notifications = require('../core/notify');
const { createUploadChecker } = require('../modules/youtube/uploads');

async function main() {
    const destination = process.env.YOUTUBE_DISCORD_CHANNEL_ID;
    if (!process.env.DISCORD_TOKEN || !destination) {
        throw new Error('DISCORD_TOKEN and YOUTUBE_DISCORD_CHANNEL_ID are required');
    }
    const channelId = process.env.YOUTUBE_CHANNEL_ID || 'UCcHHkJ98eSfa5aj0mdTwwLQ';
    const videoId = 'SIMULATED01';
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const loginTimeout = setTimeout(() => {
        console.error('Discord connection timed out');
        client.destroy();
        process.exitCode = 1;
    }, 30000);
    try {
        const ready = once(client, 'clientReady');
        await client.login(process.env.DISCORD_TOKEN);
        await ready;
        clearTimeout(loginTimeout);
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
        console.log(`Simulated upload delivered to Discord channel ${destination}`);
    } finally {
        clearTimeout(loginTimeout);
        client.destroy();
    }
}

main().catch(error => {
    console.error('YouTube simulation failed:', error.message);
    process.exitCode = 1;
});
