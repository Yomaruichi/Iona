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

function createUploadChecker({ apiKey, destination, channelId, db, notify, fetchImpl = fetch, log = console.log }) {
    let running = false;
    const stateKey = `${channelId}:${destination}`;

    async function api(resource, parameters, metrics) {
        metrics.apiRequests++;
        log(`[youtube] Requesting Data API ${resource}`);
        const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
        url.search = new URLSearchParams({ key: apiKey, ...parameters });
        const result = await request(url.toString(), 'json');
        if (!Array.isArray(result.items)) throw new Error(`Invalid YouTube ${resource} response`);
        return result.items;
    }

    async function request(url, format) {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
        // Do not include the URL or response body: they may expose the API key.
        if (!response.ok) throw new Error(`YouTube request failed (${response.status})`);
        return response[format]();
    }

    return async function checkUploads() {
        if (running) return;
        running = true;
        try {
            const metrics = { apiRequests: 0, notified: 0 };
            const feed = await request(`https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, 'text');
            let feedIds = parseVideoIds(feed);
            const saved = await db.getState('youtube', stateKey);
            const emptyLegacyState = saved && !saved.initialized && !saved.seen.length && !saved.pending.length;
            const state = saved || { seen: [], pending: [] };
            if (!feedIds.length) {
                log('[youtube] Feed contained no videos; checking uploads playlist via Data API');
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
            log(`[youtube] Discovered ${feedIds.length} videos; pending=${state.pending.length}`);
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
            available.sort((a, b) => Date.parse(a.liveStreamingDetails?.actualEndTime || a.snippet.publishedAt)
                - Date.parse(b.liveStreamingDetails?.actualEndTime || b.snippet.publishedAt));

            if (!saved || emptyLegacyState) {
                // Establish a quiet baseline; live/upcoming videos remain pending for later.
                state.seen = available.map(video => video.id);
                state.pending = candidates.filter(id => !state.seen.includes(id));
                state.initialized = true;
                await db.setState('youtube', stateKey, state);
                log(`[youtube] Baseline saved: seen=${state.seen.length}, pending=${state.pending.length}, apiRequests=${metrics.apiRequests}`);
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
            log(`[youtube] Check complete: apiRequests=${metrics.apiRequests}, notified=${metrics.notified}, seen=${state.seen.length}, pending=${state.pending.length}`);
        } finally {
            running = false;
        }
    };
}

module.exports = { createUploadChecker, isAvailable, parseVideoIds };
