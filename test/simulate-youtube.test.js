const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendLatestVideoTest } = require('../src/tools/simulateYoutube');

const channelId = 'mint-channel';

function video(id, publishedAt, overrides = {}) {
    return {
        id, snippet: { channelId, title: 'Mint upload', publishedAt, liveBroadcastContent: 'none' },
        status: { privacyStatus: 'public', uploadStatus: 'processed' }, ...overrides,
    };
}

function fixture(videos) {
    const requests = [];
    const sent = [];
    return {
        requests, sent,
        options: {
            apiKey: 'fake-api-key', channelId, destination: 'discord-channel',
            notify: async (destination, message) => sent.push({ destination, ...message }),
            fetchImpl: async address => {
                const url = new URL(address);
                requests.push(url);
                const items = url.pathname.endsWith('/channels')
                    ? [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: 'mint-uploads' } } }]
                    : url.pathname.endsWith('/playlistItems')
                        ? videos.map(item => ({ contentDetails: { videoId: item.id } })) : videos;
                return { ok: true, json: async () => ({ items }) };
            },
        },
    };
}

test('manual test fetches real endpoint shapes and sends only the newest available video', async () => {
    // Metadata order is deliberately reversed so selection cannot rely on API array order.
    const setup = fixture([
        video('older000001', '2026-10-25T00:00:00Z'),
        video('newer000001', '2026-10-27T00:00:00Z'),
    ]);
    await sendLatestVideoTest(setup.options);

    assert.equal(setup.requests.length, 3);
    assert.deepEqual(setup.requests.map(url => url.pathname.split('/').pop()), ['channels', 'playlistItems', 'videos']);
    assert.equal(setup.requests[1].searchParams.get('maxResults'), '50');
    assert.equal(setup.sent.length, 1);
    assert.equal(setup.sent[0].destination, 'discord-channel');
    assert.equal(setup.sent[0].url, 'https://www.youtube.com/watch?v=newer000001');
    assert.match(setup.sent[0].title, /^\[TEST\]/);
});

test('manual test skips live streams and prefers the most recently finished replay', async () => {
    const setup = fixture([
        video('upload00001', '2026-10-26T01:00:00Z'),
        video('replay00001', '2026-10-25T00:00:00Z', {
            liveStreamingDetails: { actualEndTime: '2026-10-27T01:00:00Z' },
        }),
        video('live0000001', '2026-10-27T02:00:00Z', {
            snippet: { channelId, title: 'Live now', liveBroadcastContent: 'live' },
        }),
    ]);
    await sendLatestVideoTest(setup.options);
    assert.equal(setup.sent[0].url, 'https://www.youtube.com/watch?v=replay00001');
    assert.match(setup.sent[0].body, /stream replay/);
});

test('manual test sends no dummy notification when there are no uploads', async () => {
    const setup = fixture([]);
    assert.equal(await sendLatestVideoTest(setup.options), null);
    assert.equal(setup.requests.length, 2);
    assert.equal(setup.sent.length, 0);
});

test('manual test sends nothing when all discovered videos are unavailable', async () => {
    const setup = fixture([video('private0001', '2026-10-27T00:00:00Z', {
        status: { privacyStatus: 'private', uploadStatus: 'processed' },
    })]);
    assert.equal(await sendLatestVideoTest(setup.options), null);
    assert.equal(setup.sent.length, 0);
});

test('manual test fails without delivery when YouTube rejects the request', async () => {
    const setup = fixture([]);
    setup.options.fetchImpl = async () => ({ ok: false, status: 403 });
    await assert.rejects(sendLatestVideoTest(setup.options), /403/);
    assert.equal(setup.sent.length, 0);
});
