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

function createUploadChecker({ apiKey, destination, channelId, db, notify, fetchImpl = fetch }) {
    let running = false;
    const stateKey = `${channelId}:${destination}`;

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
            const feed = await request(`https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, 'text');
            const feedIds = parseVideoIds(feed);
            const saved = await db.getState('youtube', stateKey);
            const state = saved || { seen: [], pending: [] };
            const candidates = [...new Set([...state.pending, ...feedIds.filter(id => !state.seen.includes(id))])];
            const videos = [];
            for (let offset = 0; offset < candidates.length; offset += 50) {
                const url = new URL('https://www.googleapis.com/youtube/v3/videos');
                url.search = new URLSearchParams({
                    key: apiKey, part: 'snippet,status,liveStreamingDetails',
                    id: candidates.slice(offset, offset + 50).join(','),
                });
                const result = await request(url.toString(), 'json');
                if (!Array.isArray(result.items)) throw new Error('Invalid YouTube video response');
                videos.push(...result.items);
            }

            // Keep unresolved IDs even after they leave the short channel feed.
            state.pending = candidates;
            const available = videos.filter(video => video.snippet?.channelId === channelId && isAvailable(video));
            available.sort((a, b) => Date.parse(a.liveStreamingDetails?.actualEndTime || a.snippet.publishedAt)
                - Date.parse(b.liveStreamingDetails?.actualEndTime || b.snippet.publishedAt));

            if (!saved) {
                // Establish a quiet baseline; live/upcoming videos remain pending for later.
                state.seen = available.map(video => video.id);
                state.pending = candidates.filter(id => !state.seen.includes(id));
                await db.setState('youtube', stateKey, state);
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
            }
        } finally {
            running = false;
        }
    };
}

module.exports = { createUploadChecker, isAvailable, parseVideoIds };
