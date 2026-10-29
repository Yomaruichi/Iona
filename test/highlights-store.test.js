const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/highlights/store');

test('only completed Mint streams are queued, due one hour after actual end time', async t => {
    const writes = [];
    t.mock.method(store.Job, 'init', async () => {});
    t.mock.method(store.Job, 'updateOne', async (...args) => { writes.push(args); });
    const replay = { id: 'replay00001', snippet: { channelId: store.MINT, title: 'Mint replay' },
        liveStreamingDetails: { actualEndTime: '2026-10-30T01:00:00Z' } };
    await store.enqueue(replay, 'destination');
    await store.enqueue({ ...replay, liveStreamingDetails: undefined }, 'destination');
    await store.enqueue({ ...replay, snippet: { channelId: 'other-channel' } }, 'destination');
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].$setOnInsert.dueAt.toISOString(), '2026-10-30T02:00:00.000Z');
    // Upsert by unique video ID deduplicates retries without rewriting existing progress.
    assert.deepEqual(writes[0][0], { videoId: 'replay00001' });
    assert.equal(writes[0][2].upsert, true);
    assert.equal(writes[0][1].$set, undefined);
});

test('claiming work requires a due date and expired lease, while updates reject a lost lease', async t => {
    let claimQuery;
    t.mock.method(store.Job, 'updateMany', async () => {});
    t.mock.method(store.Job, 'findOneAndUpdate', (query, change) => {
        claimQuery = query;
        assert.equal(change.$inc.attempts, 1);
        assert.ok(change.$set.lease);
        return { lean: async () => null };
    });
    await store.claim(false);
    assert.ok(claimQuery.dueAt.$lte instanceof Date);
    assert.ok(claimQuery.$or[1].leaseUntil.$lte instanceof Date);
    assert.equal(claimQuery.attempts.$lt, 3);
    t.mock.method(store.Job, 'updateOne', async () => ({ matchedCount: 0 }));
    await assert.rejects(store.save({ _id: 'job', lease: 'old-owner' }, { progress: {} }), /lease lost/);
});

test('concurrent replay insertion tolerates duplicate keys but propagates database failures', async t => {
    t.mock.method(store.Job, 'init', async () => {});
    const replay = { id: 'replay00001', snippet: { channelId: store.MINT, title: 'Replay' },
        liveStreamingDetails: { actualEndTime: '2026-10-30T01:00:00Z' } };
    t.mock.method(store.Job, 'updateOne', async () => { throw Object.assign(new Error('Duplicate'), { code: 11000 }); });
    // Another worker may have created this exact replay between discovery and insertion.
    await store.enqueue(replay, 'destination');

    const outage = Object.assign(new Error('Database unavailable'), { code: 'ECONNRESET' });
    t.mock.method(store.Job, 'updateOne', async () => { throw outage; });
    await assert.rejects(store.enqueue(replay, 'destination'), error => error === outage);
});
