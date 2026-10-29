const { test } = require('node:test');
const assert = require('node:assert/strict');
const { access, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
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

function fixture() {
    const job = { videoId: 'replay00001', attempts: 1, progress: {}, title: 'Replay' };
    const calls = { comments: 0, ai: 0, uploads: 0, directories: [] };
    const deps = {
        signal: new AbortController().signal,
        store: {
            save: async () => {},
            finish: async (_job, status) => { job.status = status; },
        },
        api: {
            comments: async () => { calls.comments++; return [{ text: '1:00 Funny story\n5:00 Reaction' }]; },
            select: async () => { calls.ai++; return ['t0', 't1']; },
        },
        media: {
            duration: async () => 1000,
            extract: async (_job, _clip, directory) => {
                calls.directories.push(directory);
                const path = join(directory, 'clip.mp4');
                await writeFile(path, 'fixture');
                return path;
            },
        },
        upload: async () => { calls.uploads++; return `file-${calls.uploads}`; },
    };
    return { job, calls, deps };
}

test('no timestamp match is terminal and never invokes AI or media processing', async () => {
    const { job, calls, deps } = fixture();
    deps.api.comments = async () => [];
    await processJob(job, deps);
    assert.equal(job.status, 'skipped_no_timestamps');
    assert.equal(calls.ai, 0);
    assert.equal(calls.uploads, 0);
});

test('upload retries reuse saved comments, AI decisions and uploaded file IDs, cleaning temporary files', async () => {
    const { job, calls, deps } = fixture();
    const upload = deps.upload;
    deps.upload = async (...args) => {
        if (calls.uploads === 1) { calls.uploads++; throw new Error('upload failed'); }
        return upload(...args);
    };
    await assert.rejects(processJob(job, deps), /upload failed/);
    assert.equal(job.status, 'queued');
    assert.equal(job.progress.clips[0].fileId, 'file-1');
    job.attempts++;
    deps.upload = upload;
    await processJob(job, deps);
    assert.equal(job.status, 'completed');
    assert.equal(calls.comments, 1);
    assert.equal(calls.ai, 1);
    for (const directory of calls.directories) await assert.rejects(access(directory));
});

test('the third failed processing attempt is terminal and retains successful discovery', async () => {
    const { job, deps } = fixture();
    job.attempts = 3;
    deps.api.select = async () => { throw new Error('AI unavailable'); };
    await assert.rejects(processJob(job, deps), /AI unavailable/);
    assert.equal(job.status, 'failed');
    assert.equal(job.progress.comments.length, 1);
});

test('benchmark execution processes only one selected clip', async () => {
    const { job, calls, deps } = fixture();
    job.benchmark = true;
    await processJob(job, deps);
    assert.equal(calls.uploads, 1);
});
