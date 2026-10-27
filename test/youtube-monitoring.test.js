const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readChannelIds, selectChannel } = require('../src/modules/youtube/config');
const { createMonitoringJobs } = require('../src/modules/youtube/monitoring');

test('channel configuration defaults to Mint and preserves the legacy single-channel setting', () => {
    assert.deepEqual(readChannelIds({}), ['UCcHHkJ98eSfa5aj0mdTwwLQ']);
    assert.deepEqual(readChannelIds({ YOUTUBE_CHANNEL_ID: 'legacy-channel' }), ['legacy-channel']);
});

test('channel lists trim whitespace, remove duplicates, and take precedence over the legacy setting', () => {
    assert.deepEqual(readChannelIds({
        YOUTUBE_CHANNEL_IDS: ' first-channel, second-channel, first-channel, ',
        YOUTUBE_CHANNEL_ID: 'legacy-channel',
    }), ['first-channel', 'second-channel']);
    assert.throws(() => readChannelIds({ YOUTUBE_CHANNEL_IDS: ' , , ' }), { code: 'INVALID_CHANNEL_CONFIGURATION' });
});

test('manual tools select the first configured channel by default and accept a configured override', () => {
    const env = { YOUTUBE_CHANNEL_IDS: 'first-channel,second-channel' };
    assert.equal(selectChannel(env), 'first-channel');
    assert.equal(selectChannel(env, 'second-channel'), 'second-channel');
    assert.throws(() => selectChannel(env, 'unknown-channel'), { code: 'CHANNEL_NOT_CONFIGURED' });
});

function setup() {
    const states = new Map();
    const sent = [];
    const sources = { 'first-channel': 'first000001', 'second-channel': 'second00001' };
    const fixture = { states, sent, failFirst: false };
    fixture.options = {
        channelIds: Object.keys(sources), apiKey: 'test-key', destination: 'discord-channel', log: () => {},
        db: {
            getState: async (_module, key) => structuredClone(states.get(key) || null),
            setState: async (_module, key, state) => states.set(key, structuredClone(state)),
        },
        notify: async (destination, message) => sent.push({ destination, ...message }),
        fetchImpl: async address => {
            const url = new URL(address);
            if (url.pathname.includes('/xml/feeds/')) {
                const source = url.searchParams.get('channel_id');
                if (fixture.failFirst && source === 'first-channel') return { ok: false, status: 503 };
                return { ok: true, text: async () => `<feed><yt:videoId>${sources[source]}</yt:videoId></feed>` };
            }
            const ids = url.searchParams.get('id').split(',');
            const items = Object.entries(sources).filter(([, id]) => ids.includes(id)).map(([channelId, id]) => ({
                id, snippet: { channelId, title: channelId, publishedAt: '2026-10-28T00:00:00Z', liveBroadcastContent: 'none' },
                status: { privacyStatus: 'public', uploadStatus: 'processed' },
            }));
            return { ok: true, json: async () => ({ items }) };
        },
    };
    return fixture;
}

test('each source retains its own baseline and restart-safe deduplication in the shared destination', async () => {
    const fixture = setup();
    const firstKey = 'first-channel:discord-channel';
    const secondKey = 'second-channel:discord-channel';
    // The existing source is initialized; adding another source must quietly create only its own baseline.
    fixture.states.set(firstKey, { initialized: true, seen: [], pending: [] });
    const jobs = createMonitoringJobs(fixture.options);
    assert.deepEqual(jobs.map(job => job.label), ['uploads:first-channel', 'uploads:second-channel']);
    assert.ok(jobs.every(job => job.schedule === '0 */1 * * *'));
    await Promise.all(jobs.map(job => job.task()));

    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.sent[0].destination, 'discord-channel');
    assert.deepEqual(fixture.states.get(firstKey).seen, ['first000001']);
    assert.deepEqual(fixture.states.get(secondKey).seen, ['second00001']);

    // Recreating all jobs simulates a process restart and must not announce either video again.
    await Promise.all(createMonitoringJobs(fixture.options).map(job => job.task()));
    assert.equal(fixture.sent.length, 1);
});

test('a failing source does not block another source and recovers without losing independent progress', async () => {
    const fixture = setup();
    fixture.failFirst = true;
    for (const source of fixture.options.channelIds) {
        fixture.states.set(`${source}:discord-channel`, { initialized: true, seen: [], pending: [] });
    }
    const jobs = createMonitoringJobs(fixture.options);
    const results = await Promise.allSettled(jobs.map(job => job.task()));
    assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled']);
    assert.equal(fixture.sent.length, 1);
    assert.deepEqual(fixture.states.get('first-channel:discord-channel').seen, []);
    assert.deepEqual(fixture.states.get('second-channel:discord-channel').seen, ['second00001']);

    fixture.failFirst = false;
    await jobs[0].task();
    assert.equal(fixture.sent.length, 2);
    assert.deepEqual(fixture.states.get('first-channel:discord-channel').seen, ['first000001']);
});
