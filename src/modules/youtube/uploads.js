const { createLogger, safeError } = require('../../core/logger');
const { YouTubeApi } = require('./api');
const { isAvailable, belongsToChannel, availableAt, parseVideoIds } = require('./videos');

function needsBaseline(saved) {
    if (!saved) return true;
    if (saved.initialized) return false;
    return saved.seen.length === 0 && saved.pending.length === 0;
}

function candidateIds(state, discovered) {
    const unseen = discovered.filter(id => !state.seen.includes(id));
    return [...new Set([...state.pending, ...unseen])];
}

class UploadChecker {
    constructor({ apiKey, destination, channelId, db, notify, fetchImpl, log }) {
        this.destination = destination;
        this.channelId = channelId;
        this.db = db;
        this.notify = notify;
        this.stateKey = `${channelId}:${destination}`;
        this.log = createLogger('youtube', { sink: log });
        this.api = new YouTubeApi({ apiKey, fetchImpl, logger: this.log });
        this.running = false;
    }

    async discover(feed, state) {
        const feedIds = parseVideoIds(feed);
        if (feedIds.length) return feedIds;
        // WARN for an empty feed; continue through the official uploads playlist.
        this.log.warn('feed_empty', { nextAction: 'uploads_playlist_fallback' });
        if (!state.uploadsPlaylistId) state.uploadsPlaylistId = await this.api.playlist(this.channelId);
        const ids = await this.api.uploads(state.uploadsPlaylistId);
        if (!ids.length && !state.pending.length) {
            throw new Error('YouTube discovery returned no videos; state was not updated');
        }
        return ids;
    }

    async availableVideos(candidates) {
        const videos = await this.api.videos(candidates);
        const available = videos.filter(video => belongsToChannel(video, this.channelId));
        // INFO after metadata filtering; deferred includes unfinished or inaccessible candidates.
        this.log.info('availability_checked', { candidates: candidates.length, available: available.length, deferred: candidates.length - available.length });
        return available.sort((left, right) => availableAt(left) - availableAt(right));
    }

    save(state) {
        return this.db.setState('youtube', this.stateKey, state);
    }

    summary(state, started) {
        return {
            channelId: this.channelId, seen: state.seen.length, pending: state.pending.length,
            apiRequests: this.api.requests, elapsedMs: Date.now() - started,
        };
    }

    async baseline(state, available, started) {
        state.seen = available.map(video => video.id);
        state.pending = state.pending.filter(id => !state.seen.includes(id));
        state.initialized = true;
        await this.save(state);
        // INFO after persisting a quiet baseline, including repair of legacy empty records.
        this.log.info('baseline_saved', this.summary(state, started));
    }

    async announce(state, available) {
        await this.save(state);
        for (const video of available) {
            await this.notify(this.destination, {
                title: video.snippet.title.slice(0, 256),
                body: video.liveStreamingDetails ? 'Stream replay is available.' : 'New video uploaded.',
                url: `https://www.youtube.com/watch?v=${video.id}`,
            });
            state.seen = [...state.seen, video.id].slice(-500);
            state.pending = state.pending.filter(id => id !== video.id);
            await this.save(state);
        }
    }

    async poll(started) {
        this.api.requests = 0;
        const feed = await this.api.feed(this.channelId);
        const saved = await this.db.getState('youtube', this.stateKey);
        const initialize = needsBaseline(saved);
        const state = saved || { seen: [], pending: [] };
        const discovered = await this.discover(feed, state);
        // INFO after discovery; counts describe unique discovered IDs and previously unresolved videos.
        this.log.info('discovery_completed', { discovered: discovered.length, pending: state.pending.length });
        const candidates = candidateIds(state, discovered);
        const available = await this.availableVideos(candidates);
        state.pending = candidates;
        if (initialize) return this.baseline(state, available, started);
        await this.announce(state, available);
        // INFO after delivery and persistence; zero counts expose normal no-work checks.
        this.log.info('check_completed', { ...this.summary(state, started), notified: available.length });
    }

    async checkUploads() {
        if (this.running) {
            // INFO when a previous check is still active; the original run retains responsibility for progress.
            this.log.info('check_skipped', { reason: 'already_running', channelId: this.channelId });
            return;
        }
        this.running = true;
        const started = Date.now();
        // INFO at poll startup; started correlates this execution with host timestamps.
        this.log.info('check_started', { channelId: this.channelId, started });
        try {
            await this.poll(started);
        } catch (error) {
            // ERROR for an unsuccessful poll; release the overlap guard and allow the next scheduled retry.
            this.log.error('check_failed', { channelId: this.channelId, ...safeError(error), elapsedMs: Date.now() - started, nextAction: 'next_scheduled_run' });
            throw error;
        } finally {
            this.running = false;
        }
    }
}

function createUploadChecker(options) {
    const checker = new UploadChecker(options);
    return checker.checkUploads.bind(checker);
}

module.exports = { createUploadChecker, isAvailable, parseVideoIds };
