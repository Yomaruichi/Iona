const { test } = require('node:test');
const assert = require('node:assert/strict');
const notifications = require('../src/core/notify');
const { highlightMessage } = require('../src/highlights/message');

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

test('three highlights are sent in one embed without message links generating YouTube previews', async () => {
    let payload;

    notifications.init({ channels: { fetch: async () => ({ send: async message => { payload = message; } }) } });

    const job = { videoId: 'orJ2xodaKdI', title: 'Replay 👻', progress: { clips:
        [60, 300, 600].map(seconds => ({ seconds, start: seconds - 30, end: seconds + 90, description: 'Moment' })),
    } };

    // Exercise the formatter and actual notification adapter together without sending to Discord.
    await notifications.notify('channel', highlightMessage(job));

    assert.equal(payload.embeds.length, 1);
    assert.equal(payload.content, undefined);
    assert.equal(payload.embeds[0].title, 'Replay 👻');
    // The cover belongs to the same embed as all timestamp suggestions.
    assert.deepEqual(payload.embeds[0].image, { url: 'https://i.ytimg.com/vi/orJ2xodaKdI/hqdefault.jpg' });
    assert.equal(payload.embeds[0].url, undefined);
    assert.equal((payload.embeds[0].description.match(/Suggested cut:/g) || []).length, 3);
});

test('an unavailable notification channel rejects delivery so callers can retry', async () => {
    notifications.init({ channels: { fetch: async () => null } });
    await assert.rejects(notifications.notify('missing', { title: 'Upload' }), /channel missing not found/);
});

test('text notifications preserve a title hyperlink without custom embeds or preview suppression', async () => {
    let sentMessage;
    notifications.init({ channels: { fetch: async () => ({
        send: async payload => { sentMessage = payload; },
    }) } });
    const content = 'Stream replay is available. [Mint stream title](https://www.youtube.com/watch?v=replay00001)';

    await notifications.notify('channel', { content });

    // Preserve the requested Markdown link in content without adding custom embeds or suppress flags.
    assert.deepEqual(sentMessage, { content, allowedMentions: { parse: [] } });
});
