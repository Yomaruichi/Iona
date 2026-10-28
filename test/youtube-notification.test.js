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
