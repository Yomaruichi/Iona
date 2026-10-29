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

async function prepareClips(job, candidates, { api }, checkpoint) {
    const progress = job.progress;
    if (!progress.duration) {
        progress.duration = await api.duration(job.videoId);
        await checkpoint();
    }
    if (progress.clips) return;
    const ids = await api.select(job, candidates);
    progress.clips = validateSelection(ids, candidates, progress.duration);
    await checkpoint();
}

async function processJob(job, dependencies) {
    const { store } = dependencies;
    const progress = job.progress;
    const checkpoint = () => store.save(job, { progress });
    // INFO on claimed job execution; attempts measures bounded recovery runs.
    log.info('job_started', { videoId: job.videoId, attempts: job.attempts });
    try {
        if (!await selectHighlights(job, dependencies, checkpoint)) return;
        progress.delivery = 'youtube_links';
        await store.finish(job, 'completed');
        // INFO after timestamp selections are ready for Iona's Discord sender; no media files are generated.
        log.info('job_completed', { videoId: job.videoId, highlights: progress.clips.length, delivery: progress.delivery });
    } catch (error) {
        const status = job.attempts >= 3 ? 'failed' : 'queued';
        await store.finish(job, status, safeError(error));
        // ERROR on failed execution; nextAction indicates bounded retry versus a terminal failure.
        log.error('job_failed', { videoId: job.videoId, ...safeError(error), nextAction: status });
        throw error;
    }
}

async function selectHighlights(job, dependencies, checkpoint) {
    if (job.progress.clips?.length) return true;
    const candidates = await loadCandidates(job, dependencies, checkpoint);
    if (candidates.length) {
        await prepareClips(job, candidates, dependencies, checkpoint);
        return true;
    }
    await dependencies.store.finish(job, 'skipped_no_timestamps');
    // INFO for a terminal no-match result; no future automatic comment scans will occur.
    log.info('job_skipped', { videoId: job.videoId, reason: 'no_timestamps' });
    return false;
}

module.exports = { processJob };
