let client;
const { createLogger, safeError } = require('./logger');
const log = createLogger('notify');

function init(discordClient) {
    client = discordClient;
    // INFO when a Discord client is assigned to the shared sender.
    log.info('initialized');
}

async function notify(channelId, { title, body, url }) {
    try {
        if (!client) throw new Error('notify.init(client) not called yet');
        // INFO before destination lookup and delivery; no message body or link is logged.
        log.info('delivery_started', { channelId });
        const channel = await client.channels.fetch(channelId);
        if (!channel) throw new Error(`notify: channel ${channelId} not found`);

        await channel.send({
            embeds: [{
                title,
                description: body,
                url,
                timestamp: new Date().toISOString(),
            }],
        });
        // INFO only after Discord accepts the send operation.
        log.info('delivery_completed', { channelId });
    } catch (error) {
        // ERROR when initialization, lookup, or send fails; the caller decides whether to retry.
        log.error('delivery_failed', { channelId, ...safeError(error), nextAction: 'caller_handles_retry' });
        throw error;
    }
}

module.exports = { init, notify };
