const { createLogger, safeError } = require('../../core/logger');

function isAvailable(video) {
    if (video.status?.privacyStatus !== 'public' || video.status?.uploadStatus !== 'processed') return false;
    if (['live', 'upcoming'].includes(video.snippet?.liveBroadcastContent)) return false;
    // A broadcast must have ended; a regular upload has no streaming details.
    return !video.liveStreamingDetails || Boolean(video.liveStreamingDetails.actualEndTime);
}

function parseVideoIds(xml) {
    if (!/<feed(?:\s|>)/.test(xml) || !xml.includes('</feed>')) throw new Error('Invalid YouTube feed');
    return [...new Set([...xml.matchAll(/<yt:videoId>\s*([A-Za-z0-9_-]{11})\s*<\/yt:videoId>/g)].map(match => match[1]))];
}

function createUploadChecker({ apiKey, destination, channelId, db, notify, fetchImpl = fetch, log }) {
    let running = false;
    const stateKey = `${channelId}:${destination}`;
    const logger = createLogger('youtube', { sink: log });

    async function api(resource, parameters, metrics) {
        metrics.apiRequests++;
        // INFO before a Data API request; resource names the endpoint and apiRequests counts attempts.
        logger.info('api_request_started', { resource, apiRequests: metrics.apiRequests });
        const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
        url.search = new URLSearchParams({ key: apiKey, ...parameters });
        const result = await request(url.toString(), 'json', resource);
        if (!Array.isArray(result.items)) throw new Error(`Invalid YouTube ${resource} response`);
        // INFO after metadata validation; itemCount is the number of returned resources.
        logger.info('api_request_completed', { resource, itemCount: result.items.length });
        return result.items;
    }

    async function request(url, format, resource = 'feed') {
        try {
            // DEBUG before transport; resource is a safe endpoint label, never the actual request URL.
            logger.debug('transport_started', { resource });
            const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) {
                const error = new Error(`YouTube request failed (${response.status})`);
                error.code = `HTTP_${response.status}`;
                throw error;
            }
            const result = await response[format]();
            // DEBUG after the response body decodes; status reports HTTP completion, not valid business data.
            logger.debug('transport_completed', { resource, status: response.status });
            return result;
        } catch (error) {
            // ERROR when transport, HTTP, or decoding fails; resource omits the credential-bearing URL.
            logger.error('request_failed', { resource, ...safeError(error), nextAction: 'abort_check' });
            throw error;
        }
    }

    return async function checkUploads() {
        if (running) {
            // INFO for an intentional overlap skip; the original check remains responsible for progress.
            logger.info('check_skipped', { reason: 'already_running', channelId });
            return;
        }
        running = true;
        const started = Date.now();
        // INFO at the beginning of each poll; started correlates the lifecycle with host timestamps.
        logger.info('check_started', { channelId, started });
        try {
            const metrics = { apiRequests: 0, notified: 0 };
            const feed = await request(`https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, 'text');
            let feedIds = parseVideoIds(feed);
            const saved = await db.getState('youtube', stateKey);
            const emptyLegacyState = saved && !saved.initialized && !saved.seen.length && !saved.pending.length;
            const state = saved || { seen: [], pending: [] };
            if (!feedIds.length) {
                // WARN for an empty feed; discovery continues through the official uploads playlist.
                logger.warn('feed_empty', { nextAction: 'uploads_playlist_fallback' });
                if (!state.uploadsPlaylistId) {
                    const channels = await api('channels', { part: 'contentDetails', id: channelId }, metrics);
                    state.uploadsPlaylistId = channels[0]?.contentDetails?.relatedPlaylists?.uploads;
                    if (!state.uploadsPlaylistId) throw new Error('YouTube channel has no accessible uploads playlist');
                }
                const uploads = await api('playlistItems', {
                    part: 'contentDetails', playlistId: state.uploadsPlaylistId, maxResults: '50',
                }, metrics);
                feedIds = [...new Set(uploads.map(item => item.contentDetails?.videoId)
                    .filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id)))];
                if (!feedIds.length && !state.pending.length) throw new Error('YouTube discovery returned no videos; state was not updated');
            }
            // INFO after discovery; discovered counts unique IDs and pending counts previously unresolved videos.
            logger.info('discovery_completed', { discovered: feedIds.length, pending: state.pending.length });
            const candidates = [...new Set([...state.pending, ...feedIds.filter(id => !state.seen.includes(id))])];
            const videos = [];
            for (let offset = 0; offset < candidates.length; offset += 50) {
                const items = await api('videos', {
                    part: 'snippet,status,liveStreamingDetails',
                    id: candidates.slice(offset, offset + 50).join(','),
                }, metrics);
                videos.push(...items);
            }

            // Keep unresolved IDs even after they leave the short channel feed.
            state.pending = candidates;
            const available = videos.filter(video => video.snippet?.channelId === channelId && isAvailable(video));
            // INFO after availability filtering; deferred includes inaccessible or unfinished candidates.
            logger.info('availability_checked', { candidates: candidates.length, available: available.length, deferred: candidates.length - available.length });
            available.sort((a, b) => Date.parse(a.liveStreamingDetails?.actualEndTime || a.snippet.publishedAt)
                - Date.parse(b.liveStreamingDetails?.actualEndTime || b.snippet.publishedAt));

            if (!saved || emptyLegacyState) {
                // Establish a quiet baseline; live/upcoming videos remain pending for later.
                state.seen = available.map(video => video.id);
                state.pending = candidates.filter(id => !state.seen.includes(id));
                state.initialized = true;
                await db.setState('youtube', stateKey, state);
                // INFO after persisting the quiet baseline, including repair of legacy empty records.
                logger.info('baseline_saved', { seen: state.seen.length, pending: state.pending.length, apiRequests: metrics.apiRequests, elapsedMs: Date.now() - started });
                return;
            }

            await db.setState('youtube', stateKey, state);
            for (const video of available) {
                await notify(destination, {
                    title: video.snippet.title.slice(0, 256),
                    body: video.liveStreamingDetails ? 'Stream replay is available.' : 'New video uploaded.',
                    url: `https://www.youtube.com/watch?v=${video.id}`,
                });
                state.seen = [...state.seen, video.id].slice(-500);
                state.pending = state.pending.filter(id => id !== video.id);
                await db.setState('youtube', stateKey, state);
                metrics.notified++;
            }
            // INFO after delivery and persistence; zero counts explicitly expose successful no-work checks.
            logger.info('check_completed', { ...metrics, seen: state.seen.length, pending: state.pending.length, elapsedMs: Date.now() - started });
        } catch (error) {
            // ERROR for an unsuccessful check; running is reset and the next scheduled run may retry.
            logger.error('check_failed', { channelId, ...safeError(error), elapsedMs: Date.now() - started, nextAction: 'next_scheduled_run' });
            throw error;
        } finally {
            running = false;
        }
    };
}

module.exports = { createUploadChecker, isAvailable, parseVideoIds };
