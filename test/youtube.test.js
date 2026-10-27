const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUploadChecker, isAvailable, parseVideoIds } = require('../src/modules/youtube/uploads');

const channelId = 'mint-channel';
const uploadId = 'upload00001';
const streamId = 'stream00001';

function video(id, overrides = {}) {
    return {
        id,
        snippet: { channelId, title: 'Mint video', publishedAt: '2026-10-26T00:00:00Z', liveBroadcastContent: 'none' },
        status: { privacyStatus: 'public', uploadStatus: 'processed' },
        ...overrides,
    };
}

function setup(initialState = null) {
    // Store copies, as MongoDB would, so unsaved mutations cannot make tests pass.
    let storedState = initialState ? { initialized: true, ...structuredClone(initialState) } : null;
    const fixture = { feedIds: [uploadId], videos: [video(uploadId)], messages: [], failSend: false, failRequest: false };
    fixture.db = {
        getState: async () => structuredClone(storedState),
        setState: async (_module, _key, value) => { storedState = structuredClone(value); },
    };
    fixture.state = () => storedState;
    fixture.options = {
        apiKey: 'fake-key', channelId, destination: 'discord-channel', db: fixture.db,
        notify: async (destination, message) => {
            if (fixture.failSend) throw new Error('Discord unavailable');
            fixture.messages.push({ destination, ...message });
        },
        fetchImpl: async url => {
            if (fixture.failRequest) return { ok: false, status: 503 };
            if (url.includes('/channels?')) return { ok: true, json: async () => ({ items: [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: 'uploads-playlist' } } }] }) };
            if (url.includes('/playlistItems?')) return { ok: true, json: async () => ({ items: [] }) };
            if (url.includes('/xml/feeds/')) return {
                ok: true,
                text: async () => `<feed>${fixture.feedIds.map(id => `<entry><yt:videoId>${id}</yt:videoId></entry>`).join('')}</feed>`,
            };
            const requestedIds = new URL(url).searchParams.get('id').split(',');
            return { ok: true, json: async () => ({ items: fixture.videos.filter(item => requestedIds.includes(item.id)) }) };
        },
    };
    fixture.check = createUploadChecker(fixture.options);
    return fixture;
}

test('first check silently baselines existing uploads but tracks unfinished streams', async () => {
    const fixture = setup();
    fixture.feedIds.push(streamId);
    fixture.videos.push(video(streamId, { liveStreamingDetails: { actualStartTime: '2026-10-26T00:00:00Z' } }));

    await fixture.check();

    // Existing uploads should not flood Discord when monitoring is enabled.
    assert.equal(fixture.messages.length, 0);
    assert.deepEqual(fixture.state(), { initialized: true, seen: [uploadId], pending: [streamId] });
});
test('new uploads notify once and remain deduplicated after a checker restart', async () => {
    const fixture = setup({ seen: [], pending: [] });
    await fixture.check();
    await createUploadChecker(fixture.options)();

    assert.equal(fixture.messages.length, 1);
    assert.equal(fixture.messages[0].destination, 'discord-channel');
    assert.equal(fixture.messages[0].url, `https://www.youtube.com/watch?v=${uploadId}`);
    assert.deepEqual(fixture.state(), { initialized: true, seen: [uploadId], pending: [] });
});

test('a pending stream notifies after it ends even when it disappears from the feed', async () => {
    const fixture = setup({ seen: [], pending: [streamId] });
    fixture.feedIds = [];
    fixture.videos = [video(streamId, { liveStreamingDetails: { actualStartTime: '2026-10-26T00:00:00Z' } })];
    await fixture.check();
    assert.equal(fixture.messages.length, 0);

    // Ending alone is insufficient until YouTube also reports a processed public video.
    fixture.videos[0].liveStreamingDetails.actualEndTime = '2026-10-26T01:00:00Z';
    fixture.videos[0].status.uploadStatus = 'uploaded';
    await fixture.check();
    assert.equal(fixture.messages.length, 0);
    fixture.videos[0].status.uploadStatus = 'processed';
    await fixture.check();
    assert.equal(fixture.messages[0].body, 'Stream replay is available.');
    assert.deepEqual(fixture.state().pending, []);
});

test('upcoming, live, private, and unprocessed videos are not announcement candidates', () => {
    // Include live metadata without an end time even when the snippet says none.
    const unavailable = [
        video(uploadId, { snippet: { liveBroadcastContent: 'upcoming' } }),
        video(uploadId, { snippet: { liveBroadcastContent: 'live' } }),
        video(uploadId, { liveStreamingDetails: {} }),
        video(uploadId, { status: { privacyStatus: 'private', uploadStatus: 'processed' } }),
        video(uploadId, { status: { privacyStatus: 'public', uploadStatus: 'uploaded' } }),
    ];
    for (const candidate of unavailable) assert.equal(isAvailable(candidate), false);
    assert.equal(isAvailable(video(uploadId)), true);
});

test('failed Discord delivery remains pending and is retried on the next check', async () => {
    const fixture = setup({ seen: [], pending: [] });
    fixture.failSend = true;
    await assert.rejects(fixture.check(), /Discord unavailable/);
    assert.deepEqual(fixture.state(), { initialized: true, seen: [], pending: [uploadId] });

    fixture.failSend = false;
    await fixture.check();
    assert.equal(fixture.messages.length, 1);
});

test('failed YouTube requests leave stored progress unchanged and allow a later retry', async () => {
    const initialState = { seen: [], pending: [] };
    const fixture = setup(initialState);
    fixture.failRequest = true;
    await assert.rejects(fixture.check(), /YouTube request failed \(503\)/);
    assert.deepEqual(fixture.state(), { initialized: true, ...initialState });

    fixture.failRequest = false;
    await fixture.check();
    assert.equal(fixture.messages.length, 1);
});

test('multiple new videos are announced oldest first', async () => {
    const fixture = setup({ seen: [], pending: [] });
    fixture.feedIds = [uploadId, streamId];
    fixture.videos = [video(uploadId), video(streamId, {
        snippet: { channelId, title: 'Earlier video', publishedAt: '2026-10-25T00:00:00Z' },
    })];
    await fixture.check();
    assert.deepEqual(fixture.messages.map(message => message.title), ['Earlier video', 'Mint video']);
});

test('an overlapping check skips work while the previous request is in flight', async () => {
    const fixture = setup({ seen: [], pending: [] });
    let releaseRequest;
    const gate = new Promise(resolve => { releaseRequest = resolve; });
    let requests = 0;
    const check = createUploadChecker({ ...fixture.options, fetchImpl: async url => {
        requests++;
        await gate;
        return fixture.options.fetchImpl(url);
    } });
    const firstCheck = check();
    await check();
    assert.equal(requests, 1);
    releaseRequest();
    await firstCheck;
    assert.equal(fixture.messages.length, 1);
});

test('feed parsing extracts unique video IDs and rejects non-feed responses', () => {
    assert.deepEqual(parseVideoIds(`<feed><yt:videoId>${uploadId}</yt:videoId><yt:videoId>${uploadId}</yt:videoId></feed>`), [uploadId]);
    assert.throws(() => parseVideoIds('<html>Service unavailable</html>'), /Invalid YouTube feed/);
});

test('a static empty feed triggers API discovery and quietly repairs the legacy empty baseline', async () => {
    const fixture = setup();
    const apiPaths = [];
    const logs = [];
    let persisted = { seen: [], pending: [] };
    const check = createUploadChecker({
        ...fixture.options, log: message => logs.push(message),
        db: {
            getState: async () => structuredClone(persisted),
            setState: async (_module, _key, value) => { persisted = structuredClone(value); },
        },
        fetchImpl: async url => {
            const path = new URL(url).pathname;
            // Reproduce the real HTTP-200 template that previously hid the failure.
            if (path.includes('/xml/feeds/')) return { ok: true, text: async () => '<feed><title>YouTube video feed</title></feed>' };
            apiPaths.push(path);
            const items = path.endsWith('/channels')
                ? [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: 'uploads-playlist' } } }]
                : path.endsWith('/playlistItems') ? [{ contentDetails: { videoId: uploadId } }] : [video(uploadId)];
            return { ok: true, json: async () => ({ items }) };
        },
    });

    await check();

    assert.deepEqual(persisted.seen, [uploadId]);
    assert.equal(persisted.initialized, true);
    assert.equal(fixture.messages.length, 0);
    assert.equal(apiPaths.length, 3);
    assert.ok(logs.some(message => message.includes('apiRequests=3')));

    // The uploads playlist is cached; announced/baselined videos need no metadata call.
    apiPaths.length = 0;
    await check();
    assert.deepEqual(apiPaths, ['/youtube/v3/playlistItems']);
});

test('empty feed and empty uploads playlist fail visibly without saving a false baseline', async () => {
    const fixture = setup();
    const check = createUploadChecker({
        ...fixture.options, log: () => {},
        fetchImpl: async url => {
            if (url.includes('/xml/feeds/')) return { ok: true, text: async () => '<feed></feed>' };
            return { ok: true, json: async () => ({ items: url.includes('/channels?')
                ? [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: 'uploads-playlist' } } }] : [] }) };
        },
    });
    await assert.rejects(check(), /discovery returned no videos/);
    assert.equal(fixture.state(), null);
});

test('a delivery failure preserves earlier successful sends and retries only the remaining video', async () => {
    const fixture = setup({ seen: [], pending: [] });
    fixture.feedIds = [uploadId, streamId];
    fixture.videos.push(video(streamId, {
        snippet: { channelId, title: 'Later video', publishedAt: '2026-10-27T00:00:00Z' },
    }));
    let attempts = 0;
    const deliver = fixture.options.notify;
    fixture.options.notify = async (...args) => {
        attempts++;
        if (attempts === 2) throw new Error('Discord unavailable');
        return deliver(...args);
    };
    const check = createUploadChecker(fixture.options);

    // Persist each successful delivery so a later failed send cannot replay the whole batch.
    await assert.rejects(check(), /Discord unavailable/);
    assert.deepEqual(fixture.state().seen, [uploadId]);
    assert.deepEqual(fixture.state().pending, [streamId]);
    await check();

    assert.equal(fixture.messages.length, 2);
    assert.deepEqual(fixture.state().seen, [uploadId, streamId]);
    assert.deepEqual(fixture.state().pending, []);
});
