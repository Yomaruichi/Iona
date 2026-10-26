const { test } = require('node:test');
const assert = require('node:assert/strict');
const notifications = require('../src/core/notify');

test('notifications reject calls before initialization and send the supplied embed after initialization', async () => {
    // Sending before a Discord client is available should explain the missing setup.
    await assert.rejects(notifications.notify('channel', { title: 'Test' }), /not called yet/);
    // Capture the outgoing payload without contacting Discord.
    let sentMessage;
    const discordClient = {
        channels: {
            fetch: async channelId => {
                assert.equal(channelId, 'channel');
                return { send: async payload => { sentMessage = payload; } };
            },
        },
    };
    notifications.init(discordClient);

    await notifications.notify('channel', { title: 'Build', body: 'Passed', url: 'https://example.com' });
    // The delivered embed should preserve the content and include a valid timestamp.
    const deliveredEmbed = sentMessage.embeds[0];
    assert.equal(deliveredEmbed.title, 'Build');
    assert.equal(deliveredEmbed.description, 'Passed');
    assert.equal(deliveredEmbed.url, 'https://example.com');
    assert.ok(Number.isFinite(Date.parse(deliveredEmbed.timestamp)));
});
