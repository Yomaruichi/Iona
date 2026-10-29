const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timestamps, clipWindow, validateSelection } = require('../src/highlights/timestamps');
const { processJob } = require('../src/highlights/processor');

test('timestamp discovery combines multiple commenters, deduplicates entries and caps input at 100 comments', () => {
    const comments = [{ text: '0:20 Opening\n1:03:04 Funny story\n0:99 Invalid' }, { text: '0:20 Opening\n5:30 Reaction' }];
    comments.push(...Array.from({ length: 98 }, () => ({ text: 'no timestamps' })), { text: '9:00 Must not scan' });
    const found = timestamps(comments);
    assert.deepEqual(found.map(item => item.seconds), [20, 3784, 330]);
    assert.equal(found.length, 3);
});

test('clip windows clamp at both replay boundaries and reject invented or overlapping selections', () => {
    assert.deepEqual(clipWindow(10, 100), { start: 0, end: 100 });
    assert.deepEqual(clipWindow(190, 200), { start: 160, end: 200 });
    const candidates = [{ id: 'a', seconds: 60 }, { id: 'b', seconds: 70 }];
    assert.throws(() => validateSelection(['invented'], candidates, 500), /Unknown/);
    assert.throws(() => validateSelection(['a', 'b'], candidates, 500), /Overlapping/);
    assert.throws(() => clipWindow(200, 200), /outside/);
});

test('timestamp parsing keeps long minute notation while rejecting invalid hour components', () => {
    // Minutes can exceed 59 only when no hours component is supplied.
    const found = timestamps([{ text: '90:00 Long replay\n1:60:00 Invalid minutes\n1:00:60 Invalid seconds\n2:03:04 - Funny story' }]);
    assert.deepEqual(found.map(entry => entry.seconds), [5400, 7384]);
    assert.deepEqual(found.map(entry => entry.description), ['Long replay', 'Funny story']);
});

test('selection validation rejects malformed, oversized, repeated and out-of-range choices', () => {
    const candidates = [{ id: 'first', seconds: 60 }, { id: 'second', seconds: 300 }, { id: 'outside', seconds: 1000 }];
    for (const ids of [null, 'first', [], ['first', 'second', 'first', 'second']]) {
        assert.throws(() => validateSelection(ids, candidates, 1000), /Invalid highlight selection/);
    }
    assert.throws(() => validateSelection(['first', 'first'], candidates, 1000), /Overlapping/);
    assert.throws(() => validateSelection(['outside'], candidates, 1000), /outside/);
    for (const duration of [NaN, Infinity, 0, -1]) assert.throws(() => clipWindow(10, duration), /duration/);
    for (const seconds of [NaN, Infinity, -1, 1000]) assert.throws(() => clipWindow(seconds, 1000), /outside/);

    // Checking chronological overlap must not reorder the AI's ranking.
    const clips = validateSelection(['second', 'first'], candidates, 1000);
    assert.deepEqual(clips.map(clip => clip.id), ['second', 'first']);
});

function fixture() {
    const job = { videoId: 'replay00001', attempts: 1, progress: {}, title: 'Replay' };
    const calls = { comments: 0, ai: 0, duration: 0 };
    const deps = {
        signal: new AbortController().signal,
        store: {
            save: async () => {},
            finish: async (_job, status) => { job.status = status; },
        },
        api: {
            duration: async () => { calls.duration++; return 1000; },
            comments: async () => { calls.comments++; return [{ text: '1:00 Funny story\n5:00 Reaction' }]; },
            select: async () => { calls.ai++; return ['t0', 't1']; },
        },
        // These retired operations must never run in the manual-download workflow.
        media: { extract: () => assert.fail('No video extraction expected') },
        upload: () => assert.fail('No Drive upload expected'),
    };
    return { job, calls, deps };
}

test('no timestamp match is terminal and never invokes AI or media processing', async () => {
    const { job, calls, deps } = fixture();
    deps.api.comments = async () => [];
    await processJob(job, deps);
    assert.equal(job.status, 'skipped_no_timestamps');
    assert.equal(calls.ai, 0);
    assert.equal(calls.duration, 0);
});

test('highlight selection stores up to three timestamp windows and completes without downloading files', async () => {
    const { job, calls, deps } = fixture();
    await processJob(job, deps);
    assert.equal(job.status, 'completed');
    assert.equal(job.progress.delivery, 'youtube_links');
    assert.deepEqual(job.progress.clips.map(clip => [clip.start, clip.end]), [[30, 150], [270, 390]]);
    assert.equal(calls.comments, 1);
    assert.equal(calls.ai, 1);
    assert.equal(calls.duration, 1);
});

test('saved selections from a blocked download complete without fetching comments, duration or AI again', async () => {
    const { job, calls, deps } = fixture();
    job.progress.clips = [{ id: 't0', seconds: 60, start: 30, end: 150, description: 'Funny story' }];
    await processJob(job, deps);
    assert.equal(job.status, 'completed');
    assert.deepEqual(calls, { comments: 0, ai: 0, duration: 0 });
});

test('an AI retry reuses saved comments and API duration', async () => {
    const { job, calls, deps } = fixture();
    const select = deps.api.select;
    deps.api.select = async () => { throw new Error('AI unavailable'); };
    await assert.rejects(processJob(job, deps), /AI unavailable/);
    assert.equal(job.status, 'queued');
    job.attempts++;
    deps.api.select = select;

    await processJob(job, deps);

    assert.equal(job.status, 'completed');
    assert.equal(calls.comments, 1);
    assert.equal(calls.duration, 1);
});

test('the third failed processing attempt is terminal and retains successful discovery', async () => {
    const { job, deps } = fixture();
    job.attempts = 3;
    deps.api.select = async () => { throw new Error('AI unavailable'); };
    await assert.rejects(processJob(job, deps), /AI unavailable/);
    assert.equal(job.status, 'failed');
    assert.equal(job.progress.comments.length, 1);
});

test('manual preview keeps all selected links because no expensive clipping occurs', async () => {
    const { job, deps } = fixture();
    job.benchmark = true;
    await processJob(job, deps);
    assert.equal(job.progress.clips.length, 2);
});
