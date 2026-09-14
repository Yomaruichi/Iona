let client;

function init(discordClient) {
    client = discordClient;
}

async function notify(channelId, { title, body, url }) {
    if (!client) throw new Error('notify.init(client) not called yet');
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return console.warn(`notify: channel ${channelId} not found`);

    await channel.send({
        embeds: [{
            title,
            description: body,
            url,
            timestamp: new Date().toISOString(),
        }],
    });
}

module.exports = { init, notify };