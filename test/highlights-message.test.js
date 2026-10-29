const { test } = require('node:test');
const assert = require('node:assert/strict');
const { highlightMessage } = require('../src/highlights/message');

test('Discord highlights include replay title, timestamp links and manual cut boundaries', () => {
    const job = { videoId: 'orJ2xodaKdI', title: 'Mint [Replay]', progress: { clips: [
        { seconds: 2776, start: 2746, end: 2866, description: 'Funny reaction' },
        { seconds: 4000, start: 3970, end: 4090, description: 'Another moment' },
    ] } };
    const message = highlightMessage(job);
    assert.match(message.content, /manual download/);
    assert.ok(message.content.includes('[Mint \\[Replay\\]](https://www.youtube.com/watch?v=orJ2xodaKdI)'));
    assert.ok(message.content.includes('[46:16 — Funny reaction](https://www.youtube.com/watch?v=orJ2xodaKdI&t=2776s)'));
    assert.match(message.content, /Suggested cut: 45:46–47:46/);
    assert.match(message.content, /1:06:40 — Another moment/);
    assert.ok(!message.content.includes('drive.google.com'));
});

test('long untrusted titles and descriptions stay within Discord message limits', () => {
    const job = { videoId: 'orJ2xodaKdI', title: '[]()\\'.repeat(200), progress: { clips:
        Array.from({ length: 4 }, (_, index) => ({ seconds: 100 + index * 200, start: 70 + index * 200,
            end: 190 + index * 200, description: '[]()\\\n'.repeat(200) })),
    } };
    const message = highlightMessage(job);
    // Escaping Markdown and limiting the input keeps at most three readable suggestions in one message.
    assert.ok(message.content.length <= 2000);
    assert.equal((message.content.match(/Suggested cut:/g) || []).length, 3);
});
