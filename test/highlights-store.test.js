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

test('saved selections from exhausted media jobs become deliverable without reclaiming an active lease', async t => {
    let query;
    let update;
    t.mock.method(store.Job, 'updateMany', async (filter, change) => {
        query = filter;
        update = change;
        return { modifiedCount: 1 };
    });

    await store.recoverSelections(true, 'orJ2xodaKdI');

    // Recovery requires a saved selection and expired ownership, even after all download attempts failed.
    assert.equal(query.videoId, 'orJ2xodaKdI');
    assert.equal(query.benchmark, true);
    assert.deepEqual(query['progress.clips.0'], { $exists: true });
    assert.ok(query.status.$in.includes('failed'));
    assert.ok(!query.status.$in.includes('completed'));
    assert.ok(query.$or[1].leaseUntil.$lte instanceof Date);
    assert.equal(update.$set.status, 'completed');
    assert.equal(update.$set['progress.delivery'], 'youtube_links');
    assert.equal(update.$set.progress, undefined);
});

test('completed timestamp suggestions are delivered to their recorded Discord destination and marked sent', async t => {
    const job = { _id: 'job', videoId: 'orJ2xodaKdI', destination: 'destination', title: 'Replay',
        progress: { clips: [{ seconds: 2776, start: 2746, end: 2866, description: 'Funny reaction' }] } };
    let claimed = false;
    let marked = false;
    let sends = 0;
    t.mock.method(store.Job, 'findOneAndUpdate', () => ({ lean: async () => {
        if (claimed) return null;
        claimed = true;
        return job;
    } }));
    t.mock.method(store.Job, 'updateOne', async (_filter, change) => { marked = change.$set.notified; });
    const notify = async (destination, message) => {
        assert.equal(marked, false);
        assert.equal(destination, 'destination');
        assert.match(message.content, /t=2776s/);
        sends++;
    };

    await store.deliverCompleted(notify);
    await store.deliverCompleted(notify);

    assert.equal(marked, true);
    assert.equal(sends, 1);
});

test('failed Discord delivery leaves the completion unmarked for a later delivery retry', async t => {
    const job = { videoId: 'orJ2xodaKdI', title: 'Replay', progress: { clips: [
        { seconds: 60, start: 30, end: 150, description: 'Moment' },
    ] } };
    t.mock.method(store.Job, 'findOneAndUpdate', () => ({ lean: async () => job }));
    const save = t.mock.method(store.Job, 'updateOne', async () => {});

    await assert.rejects(store.deliverCompleted(async () => { throw new Error('Discord unavailable'); }), /Discord unavailable/);

    assert.equal(save.mock.calls.length, 0);
});
