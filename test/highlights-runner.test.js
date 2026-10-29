const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/core/db');
const store = require('../src/highlights/store');
const { YouTubeApi } = require('../src/modules/youtube/api');
const { main, configuration } = require('../src/highlights/runner');

const configured = {
    MONGO_DB: 'test-database', YOUTUBE_API_KEY: 'test-youtube', OPENROUTER_API_KEY: 'test-openrouter',
    OPENROUTER_MODEL: 'test-model', YOUTUBE_DISCORD_CHANNEL_ID: 'destination',
};

function mockQueue(t) {
    const calls = { connections: 0, claims: [], enqueued: [] };
    t.mock.method(db, 'connect', async () => { calls.connections++; });
    t.mock.method(store.Job, 'init', async () => {});
    t.mock.method(store, 'claim', async (...args) => { calls.claims.push(args); return null; });
    t.mock.method(store, 'enqueue', async (...args) => { calls.enqueued.push(args); });
    t.mock.method(store, 'recoverSelections', async () => {});
    return calls;
}

test('timestamp-link worker configuration does not require Google OAuth or Drive credentials', () => {
    assert.doesNotThrow(() => configuration(configured));
});

test('disabled worker exits without opening the database or making external requests', async t => {
    const calls = mockQueue(t);
    t.mock.method(global, 'fetch', () => assert.fail('Disabled worker must not request external services'));

    await main({}, null);

    assert.equal(calls.connections, 0);
    assert.equal(calls.claims.length, 0);
});

test('automatic worker requires benchmark approval and complete credentials before connecting', async t => {
    const calls = mockQueue(t);
    await assert.rejects(main({ ...configured, HIGHLIGHTS_ENABLED: 'true' }, null), /benchmark approval/);
    await assert.rejects(main({ HIGHLIGHTS_ENABLED: 'true', HIGHLIGHTS_BENCHMARK_PASSED: 'true' }, null),
        { code: 'MISSING_CONFIGURATION' });
    assert.equal(calls.connections, 0);
});

test('approved scheduled worker checks the automatic queue once and exits when nothing is due', async t => {
    const calls = mockQueue(t);
    await main({ ...configured, HIGHLIGHTS_ENABLED: 'true', HIGHLIGHTS_BENCHMARK_PASSED: 'true' }, null);
    assert.equal(calls.connections, 1);
    assert.deepEqual(calls.claims, [[false, null]]);
    assert.equal(calls.enqueued.length, 0);
});

test('manual benchmark validates a completed Mint replay and claims only that video with automation disabled', async t => {
    const calls = mockQueue(t);
    const replay = { id: 'replay00001', snippet: { channelId: store.MINT, liveBroadcastContent: 'none' },
        status: { privacyStatus: 'public', uploadStatus: 'processed' },
        liveStreamingDetails: { actualEndTime: '2026-10-30T01:00:00Z' } };
    t.mock.method(YouTubeApi.prototype, 'videos', async ids => {
        assert.deepEqual(ids, [replay.id]);
        return [replay];
    });

    await main(configured, replay.id);

    assert.deepEqual(calls.enqueued, [[replay, 'destination', true]]);
    assert.deepEqual(calls.claims, [[true, replay.id]]);
});

test('manual benchmark rejects missing videos, other creators and unfinished or unavailable replays', async t => {
    const replay = { snippet: { channelId: store.MINT }, status: { privacyStatus: 'public', uploadStatus: 'processed' },
        liveStreamingDetails: { actualEndTime: '2026-10-30T01:00:00Z' } };
    const cases = [
        { name: 'missing video', videos: [] },
        { name: 'other creator', videos: [{ ...replay, snippet: { channelId: 'other-channel' } }] },
        { name: 'private replay', videos: [{ ...replay, status: { privacyStatus: 'private', uploadStatus: 'processed' } }] },
        // A normal upload is available but must not be accepted as a completed stream.
        { name: 'normal upload', videos: [{ ...replay, liveStreamingDetails: undefined }] },
        { name: 'unfinished stream', videos: [{ ...replay, liveStreamingDetails: {} }] },
    ];
    for (const example of cases) {
        await t.test(example.name, async t => {
            const calls = mockQueue(t);
            t.mock.method(YouTubeApi.prototype, 'videos', async () => example.videos);
            await assert.rejects(main(configured, 'replay00001'), /completed public Mint replay/);
            assert.equal(calls.enqueued.length, 0);
            assert.equal(calls.claims.length, 0);
        });
    }
});
