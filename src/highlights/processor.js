const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { timestamps, validateSelection } = require('./timestamps');
const { createLogger, safeError } = require('../core/logger');
const log = createLogger('highlights');

async function loadCandidates(job, { api }, checkpoint) {
    if (!job.progress.comments) {
        job.progress.comments = await api.comments(job.videoId);
        await checkpoint();
    }
    return timestamps(job.progress.comments);
}

async function prepareClips(job, candidates, { api, media, signal }, checkpoint) {
    const progress = job.progress;
    if (!progress.duration) {
        progress.duration = await media.duration(job.videoId, signal);
        await checkpoint();
    }
    if (progress.clips) return;
    const ids = await api.select(job, candidates);
    progress.clips = validateSelection(ids, candidates, progress.duration);
    if (job.benchmark) progress.clips = progress.clips.slice(0, 1);
    await checkpoint();
}

async function processClip(job, clip, { media, upload, signal }, checkpoint) {
    if (clip.fileId) return;
    signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'iona-highlight-'));
    try {
        const path = await media.extract(job, clip, directory, signal);
        clip.fileId = await upload(job, clip, path);
        await checkpoint();
    } finally { await rm(directory, { recursive: true, force: true }); }
}

async function processJob(job, dependencies) {
    const { store } = dependencies;
    const progress = job.progress;
    const checkpoint = () => store.save(job, { progress });
    // INFO on claimed job execution; attempts measures bounded recovery runs.
    log.info('job_started', { videoId: job.videoId, attempts: job.attempts });
    try {
        const candidates = await loadCandidates(job, dependencies, checkpoint);
        if (!candidates.length) {
            await store.finish(job, 'skipped_no_timestamps');
            // INFO for a terminal no-match result; no future automatic comment scans will occur.
            log.info('job_skipped', { videoId: job.videoId, reason: 'no_timestamps' });
            return;
        }
        await prepareClips(job, candidates, dependencies, checkpoint);
        for (const clip of progress.clips) {
            await processClip(job, clip, dependencies, checkpoint);
        }
        await store.finish(job, 'completed');
        // INFO after all clips and completion state persist; completed files survive future restarts.
        log.info('job_completed', { videoId: job.videoId, clips: progress.clips.length });
    } catch (error) {
        const status = job.attempts >= 3 ? 'failed' : 'queued';
        await store.finish(job, status, safeError(error));
        // ERROR on failed execution; nextAction indicates bounded retry versus a terminal failure.
        log.error('job_failed', { videoId: job.videoId, ...safeError(error), nextAction: status });
        throw error;
    }
}

module.exports = { processJob };
