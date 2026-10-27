const { test } = require('node:test');
const assert = require('node:assert/strict');
const { YouTubeApi } = require('../src/modules/youtube/api');

function silentLogger() {
    return { info() {}, debug() {}, error() {} };
}

test('metadata fetches batch 51 video IDs into requests of 50 and 1', async () => {
    const requestedBatches = [];
    const api = new YouTubeApi({ apiKey: 'test-key', logger: silentLogger(), fetchImpl: async address => {
        const ids = new URL(address).searchParams.get('id').split(',');
        requestedBatches.push(ids);
        return { ok: true, json: async () => ({ items: ids.map(id => ({ id })) }) };
    } });
    const ids = Array.from({ length: 51 }, (_, index) => String(index).padStart(11, '0'));

    // Cross the per-request limit without losing or reordering IDs.
    const videos = await api.videos(ids);

    assert.deepEqual(requestedBatches.map(batch => batch.length), [50, 1]);
    assert.deepEqual(videos.map(video => video.id), ids);
    assert.equal(api.requests, 2);
});

test('no candidates make no metadata requests and consume no quota', async () => {
    const api = new YouTubeApi({ apiKey: 'test-key', logger: silentLogger(), fetchImpl: async () => {
        assert.fail('An empty candidate set must not fetch metadata');
    } });
    assert.deepEqual(await api.videos([]), []);
    assert.equal(api.requests, 0);
});

test('a failed metadata batch stops later batches and counts the failed attempt', async () => {
    const api = new YouTubeApi({ apiKey: 'test-key', logger: silentLogger(), fetchImpl: async () => ({ ok: false, status: 503 }) });
    const ids = Array.from({ length: 51 }, (_, index) => String(index).padStart(11, '0'));

    await assert.rejects(api.videos(ids), { code: 'HTTP_503' });
    assert.equal(api.requests, 1);
});

test('malformed metadata cannot be logged as a completed API operation', async () => {
    const completions = [];
    const logger = { ...silentLogger(), info: (event, fields) => completions.push({ event, fields }) };
    const api = new YouTubeApi({ apiKey: 'test-key', logger, fetchImpl: async () => ({ ok: true, json: async () => ({ items: null }) }) });

    await assert.rejects(api.videos(['upload00001']), /Invalid YouTube videos response/);
    assert.ok(!completions.some(entry => entry.event === 'api_request_completed'));
});

test('uploads discovery selects the requested channel and ignores malformed or duplicate video IDs', async () => {
    const api = new YouTubeApi({ apiKey: 'test-key', logger: silentLogger(), fetchImpl: async address => {
        const url = new URL(address);
        const items = url.pathname.endsWith('/channels') ? [
            { id: 'unrelated', contentDetails: { relatedPlaylists: { uploads: 'wrong' } } },
            { id: 'mint', contentDetails: { relatedPlaylists: { uploads: 'mint-uploads' } } },
        ] : [
            { contentDetails: { videoId: 'upload00001' } },
            { contentDetails: { videoId: 'upload00001' } },
            { contentDetails: { videoId: 'invalid' } }, {},
        ];
        return { ok: true, json: async () => ({ items }) };
    } });

    const playlist = await api.playlist('mint');
    assert.equal(playlist, 'mint-uploads');
    assert.deepEqual(await api.uploads(playlist), ['upload00001']);
});
