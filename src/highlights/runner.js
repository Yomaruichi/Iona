require('dotenv').config();
const { readFile } = require('node:fs/promises');
const db = require('../core/db');
const store = require('./store');
const { services } = require('./services');
const { processJob } = require('./processor');
const { YouTubeApi } = require('../modules/youtube/api');
const { isAvailable } = require('../modules/youtube/videos');
const { createLogger, safeError } = require('../core/logger');
const log = createLogger('highlights-runner');

function configuration(env) {
    const required = ['MONGO_DB', 'YOUTUBE_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'];
    if (required.some(key => !env[key])) {
        const error = new Error('Missing highlight worker configuration');
        error.code = 'MISSING_CONFIGURATION';
        throw error;
    }
}

function processingAllowed(env, benchmarkId) {
    if (benchmarkId) return true;
    if (env.HIGHLIGHTS_ENABLED !== 'true') {
        // INFO when automatic processing is deliberately disabled; no connections or paid requests occur.
        log.info('disabled');
        return false;
    }
    if (env.HIGHLIGHTS_BENCHMARK_PASSED !== 'true') throw new Error('Railway benchmark approval is required');
    return true;
}

function requireCompletedMintReplay(video) {
    const message = 'Benchmark requires a completed public Mint replay';
    if (!video) throw new Error(message);
    if (video.snippet.channelId !== store.MINT) throw new Error(message);
    if (!isAvailable(video)) throw new Error(message);
    if (!video.liveStreamingDetails?.actualEndTime) throw new Error(message);
}

async function enqueueBenchmark(benchmarkId, env) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(benchmarkId)) throw new Error('Invalid benchmark video ID');
    if (!env.YOUTUBE_DISCORD_CHANNEL_ID) throw new Error('Benchmark Discord destination is required');
    const api = new YouTubeApi({ apiKey: env.YOUTUBE_API_KEY });
    const videos = await api.videos([benchmarkId]);
    const video = videos[0];
    requireCompletedMintReplay(video);
    await store.enqueue(video, env.YOUTUBE_DISCORD_CHANNEL_ID, true);
}

async function main(env = process.env, benchmarkId = process.argv[2]) {
    if (!processingAllowed(env, benchmarkId)) return;
    configuration(env);
    await db.connect();
    await store.Job.init();
    if (benchmarkId) await enqueueBenchmark(benchmarkId, env);
    await store.recoverSelections(Boolean(benchmarkId), benchmarkId);
    const job = await store.claim(Boolean(benchmarkId), benchmarkId);
    if (!job) {
        // INFO when no due work exists; exit rather than idle on Railway.
        log.info('no_due_jobs');
        return;
    }
    await runJob(job, env);
}

async function reportMetrics(job, started) {
    const memory = await readFile('/sys/fs/cgroup/memory.peak', 'utf8').catch(() => 'unavailable');
    // INFO after processing; cgroup peak includes subprocesses, usageCost requires Railway billing review.
    log.info('run_metrics', { videoId: job.videoId, benchmark: job.benchmark, elapsedMs: Date.now() - started,
        peakMemoryBytes: memory.trim(), nodePeakRssKB: process.resourceUsage().maxRSS, usageCost: 'review_railway_dashboard' });
}

async function runJob(job, env) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('Job exceeded 20 minutes')), 1200000);
    const heartbeat = setInterval(() => store.renew(job).catch(error => controller.abort(error)), 30000);
    const started = Date.now();
    try {
        await processJob(job, { store, api: services(env, controller.signal) });
    } finally {
        clearTimeout(deadline);
        clearInterval(heartbeat);
        await reportMetrics(job, started);
    }
}

if (require.main === module) main().catch(error => {
    // ERROR when a worker invocation fails; persisted job state or an expired lease enables bounded recovery.
    log.error('run_failed', { ...safeError(error), nextAction: 'inspect_job_and_next_cron' });
    process.exitCode = 1;
}).finally(() => db.mongoose.disconnect());

module.exports = { configuration, main };
