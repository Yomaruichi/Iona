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
    // The title is plain text; only the numeric timestamp belongs inside each hyperlink.
    assert.equal(message.content.split('\n')[1], 'Mint \\[Replay\\]');
    assert.ok(message.content.includes('[46:16](https://www.youtube.com/watch?v=orJ2xodaKdI&t=2776s) — Funny reaction'));
    assert.match(message.content, /Suggested cut: 45:46–47:46/);
    assert.ok(message.content.includes('[1:06:40](https://www.youtube.com/watch?v=orJ2xodaKdI&t=4000s) — Another moment'));
    assert.ok(!message.content.includes('drive.google.com'));
});

test('emojis and brackets in creator text stay outside timestamp hyperlinks', () => {
    const job = { videoId: 'orJ2xodaKdI', title: '【MINECRAFT】 🧑‍🚀 [Mint]', progress: { clips: [
        { seconds: 2776, start: 2746, end: 2866, description: '👻 [Spooky] reaction (wow!)' },
    ] } };
    const message = highlightMessage(job);

    // User text cannot close a link label because it is placed after the completed numeric link.
    assert.equal(message.content.split('\n')[1], '【MINECRAFT】 🧑‍🚀 \\[Mint\\]');
    assert.ok(message.content.includes('[46:16](https://www.youtube.com/watch?v=orJ2xodaKdI&t=2776s) — 👻 \\[Spooky\\] reaction \\(wow!\\)'));
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
