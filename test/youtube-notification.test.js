const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uploadNotification } = require('../src/modules/youtube/notification');

test('notification titles escape link delimiters and keep Unicode text in one clickable label', () => {
    // Brackets in real stream titles must not terminate the Markdown link label.
    const message = uploadNotification({
        id: 'replay00001', snippet: { title: 'Mint [archive]\n世界' }, liveStreamingDetails: {},
    }, { test: true });

    assert.equal(message.content, '[TEST] Stream replay is available. [Mint \\[archive\\] 世界](https://www.youtube.com/watch?v=replay00001)');
});

test('stream notifications move emoji outside the title hyperlink while preserving brackets and Unicode', () => {
    const message = uploadNotification({ id: 'replay00001', liveStreamingDetails: {},
        snippet: { title: '【MINECRAFT】 Mint discovers the sanctuary 🧑‍🚀 【世界】' },
    });

    // The joined emoji remains intact after the link, rather than inside its display text.
    assert.equal(message.content,
        'Stream replay is available. [【MINECRAFT】 Mint discovers the sanctuary 【世界】](https://www.youtube.com/watch?v=replay00001) 🧑‍🚀');
});

test('upload notifications preserve skin tones, flags and keycaps without moving ordinary digits', () => {
    const message = uploadNotification({ id: 'upload00001', snippet: { title: 'Part 2 👍🏽 🇵🇭 1️⃣' } });
    assert.equal(message.content, 'New video uploaded. [Part 2](https://www.youtube.com/watch?v=upload00001) 👍🏽 🇵🇭 1️⃣');
});

test('emoji-only titles use a nonempty hyperlink label and retain the original emoji', () => {
    const message = uploadNotification({ id: 'upload00001', snippet: { title: '👻' } }, { test: true });
    assert.equal(message.content, '[TEST] New video uploaded. [YouTube video](https://www.youtube.com/watch?v=upload00001) 👻');
});
