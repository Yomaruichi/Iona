const { randomUUID } = require('node:crypto');
const { mongoose } = require('../core/db');
const { createLogger } = require('../core/logger');
const { highlightMessage } = require('./message');
const log = createLogger('highlights-store');
const MINT = 'UCcHHkJ98eSfa5aj0mdTwwLQ';
const Job = mongoose.model('HighlightJob', new mongoose.Schema({
    videoId: { type: String, unique: true, required: true },
    destination: String, title: String, dueAt: Date, benchmark: Boolean,
    status: { type: String, default: 'queued' }, attempts: { type: Number, default: 0 },
    lease: String, leaseUntil: Date, progress: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    notified: { type: Boolean, default: false }, notificationLeaseUntil: Date,
    lastError: mongoose.Schema.Types.Mixed,
}, { timestamps: true }));

async function insertReplay(video, destination, benchmark, dueAt) {
    try {
        await Job.updateOne({ videoId: video.id }, { $setOnInsert: {
            videoId: video.id, destination, title: video.snippet.title, benchmark,
            dueAt,
        } }, { upsert: true });
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
}

async function enqueue(video, destination, benchmark = false) {
    if (video.snippet?.channelId !== MINT) return;
    const end = Date.parse(video.liveStreamingDetails?.actualEndTime);
    if (!Number.isFinite(end)) return;
    await Job.init();
    const dueAt = new Date(benchmark ? Date.now() : end + 3600000);
    await insertReplay(video, destination, benchmark, dueAt);
    // INFO after idempotent insertion; videoId identifies the replay, benchmark identifies manual mode.
    log.info('enqueue_completed', { videoId: video.id, benchmark });
}

async function claim(benchmark = false, videoId) {
    const now = new Date();
    await Job.updateMany({ status: 'processing', attempts: { $gte: 3 }, leaseUntil: { $lte: now } },
        { $set: { status: 'failed', lastError: { errorCode: 'RETRY_LIMIT_AFTER_CRASH' } } });
    return Job.findOneAndUpdate({
        ...(videoId ? { videoId } : {}),
        benchmark, attempts: { $lt: 3 }, status: { $in: ['queued', 'processing'] }, dueAt: { $lte: now },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    }, { $set: { status: 'processing', lease: randomUUID(), leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } },
    { new: true, sort: { dueAt: 1 } }).lean();
}

async function save(job, fields) {
    const result = await Job.updateOne({ _id: job._id, lease: job.lease, leaseUntil: { $gt: new Date() } }, { $set: fields });
    if (!result.matchedCount) throw new Error('Highlight lease lost');
}

async function renew(job) {
    await save(job, { leaseUntil: new Date(Date.now() + 120000) });
}

async function finish(job, status, lastError) {
    await save(job, { status, progress: job.progress, lastError, leaseUntil: new Date(0) });
}

async function recoverSelections(benchmark = false, videoId) {
    const now = new Date();
    const result = await Job.updateMany({
        ...(videoId ? { videoId } : {}), benchmark,
        status: { $in: ['queued', 'processing', 'failed'] }, 'progress.clips.0': { $exists: true },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    }, { $set: { status: 'completed', 'progress.delivery': 'youtube_links', leaseUntil: new Date(0), lastError: null } });
    // INFO after recovery; count describes saved selections made deliverable without another AI call or download.
    log.info('saved_selections_recovered', { count: result.modifiedCount, benchmark });
}

async function deliverCompleted(notify) {
    const job = await Job.findOneAndUpdate({ status: 'completed', notified: false,
        $or: [{ notificationLeaseUntil: { $exists: false } }, { notificationLeaseUntil: { $lte: new Date() } }],
    }, { $set: { notificationLeaseUntil: new Date(Date.now() + 120000) } }, { new: true }).lean();
    if (!job) return;
    await notify(job.destination, highlightMessage(job));
    await Job.updateOne({ _id: job._id }, { $set: { notified: true } });
    // INFO after Discord accepts timestamp links and delivery state persists; count measures manual-download suggestions.
    log.info('links_delivered', { videoId: job.videoId, highlights: job.progress.clips.length });
}

module.exports = { Job, enqueue, claim, save, renew, finish, deliverCompleted, recoverSelections, MINT };
