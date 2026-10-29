const { test } = require('node:test');
const assert = require('node:assert/strict');
const { services } = require('../src/highlights/services');

const job = { videoId: 'orJ2xodaKdI', title: 'Replay', progress: { duration: 1000 } };
const candidates = [{ id: 't0', seconds: 100, description: 'Funny reaction' }];
const env = { YOUTUBE_API_KEY: 'test-youtube', OPENROUTER_API_KEY: 'test-openrouter', OPENROUTER_MODEL: 'openrouter/free' };

function mockSelection(t, body) {
    return t.mock.method(global, 'fetch', async () => new Response(JSON.stringify(body), { status: 200 }));
}

test('replay duration comes from the YouTube Data API without requesting a video stream', async t => {
    const request = mockSelection(t, { items: [{ contentDetails: { duration: 'PT1H2M3S' } }] });
    const api = services(env, new AbortController().signal);
    assert.equal(await api.duration(job.videoId), 3723);
    const url = new URL(request.mock.calls[0].arguments[0]);
    assert.equal(url.hostname, 'www.googleapis.com');
    assert.equal(url.searchParams.get('part'), 'contentDetails');
});

test('missing or zero replay duration fails instead of creating unbounded cut suggestions', async t => {
    mockSelection(t, { items: [{ contentDetails: { duration: 'PT0S' } }] });
    const api = services(env, new AbortController().signal);
    await assert.rejects(api.duration(job.videoId), /duration unavailable/);
});

test('OpenRouter selection requests JSON and returns supplied IDs from a valid response', async t => {
    const request = mockSelection(t, { choices: [{ finish_reason: 'stop', message: { content: '{"ids":["t0"]}' } }] });
    const api = services(env, new AbortController().signal);

    assert.deepEqual(await api.select(job, candidates), ['t0']);

    // Keep a bounded output budget while explicitly requesting machine-readable JSON.
    const sent = JSON.parse(request.mock.calls[0].arguments[1].body);
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    // Ranking supplied descriptions should not spend the answer budget on optional reasoning.
    assert.deepEqual(sent.reasoning, { enabled: false });
    assert.equal(sent.max_tokens, 1000);
    assert.equal(sent.model, 'openrouter/free');
});

test('unusable OpenRouter responses fail with specific safe codes instead of TypeErrors', async t => {
    const examples = [
        { name: 'missing choices', body: {}, code: 'SELECTION_MISSING_CHOICE' },
        { name: 'empty choices', body: { choices: [] }, code: 'SELECTION_MISSING_CHOICE' },
        { name: 'null content', content: null, code: 'SELECTION_EMPTY' },
        { name: 'blank content', content: '  ', code: 'SELECTION_EMPTY' },
        { name: 'JSON null', content: 'null', code: 'SELECTION_INVALID_IDS' },
        { name: 'missing IDs', content: '{}', code: 'SELECTION_INVALID_IDS' },
        { name: 'wrong IDs type', content: '{"ids":"t0"}', code: 'SELECTION_INVALID_IDS' },
        { name: 'invalid JSON', content: 'not JSON', code: 'SELECTION_INVALID_JSON' },
        // A reasoning model can exhaust its output budget before emitting any final answer.
        { name: 'truncated output', content: null, finishReason: 'length', code: 'SELECTION_TRUNCATED' },
        { name: 'filtered output', content: null, finishReason: 'content_filter', code: 'SELECTION_FILTERED' },
    ];
    for (const example of examples) {
        await t.test(example.name, async t => {
            const body = example.body || { choices: [{ finish_reason: example.finishReason || 'stop', message: { content: example.content } }] };
            mockSelection(t, body);
            const logs = [];
            t.mock.method(console, 'log', line => logs.push(line));
            const api = services(env, new AbortController().signal);

            await assert.rejects(api.select(job, candidates), { name: 'Error', code: example.code });
            // A response is only logged as received successfully after it contains a usable ID list.
            assert.ok(logs.every(line => !line.includes('selection_received')));
        });
    }
});
