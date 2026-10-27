const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/core/logger');

function setEnvironment(t, name, value) {
    const original = process.env[name];
    process.env[name] = value;
    t.after(() => {
        if (original === undefined) delete process.env[name];
        else process.env[name] = original;
    });
}

test('logs redact credential fields, environment secrets, URLs, and raw error messages', t => {
    const output = [];
    setEnvironment(t, 'DISCORD_TOKEN', 'test-sensitive-bot-token');
    const log = createLogger('test', { sink: line => output.push(line) });
    const error = new Error('request failed: https://example.com/?key=private');
    error.cause = { code: 'EAI_AGAIN' };

    // Secret values can occur in a nested payload or be echoed under an innocent field name.
    log.error('request_failed', {
        token: 'another-secret', nested: { password: 'secret-password' },
        detail: 'test-sensitive-bot-token', endpoint: 'https://example.com/?key=private', error,
    });

    assert.match(output[0], /^\[ERROR\]/);
    assert.match(output[0], /EAI_AGAIN/);
    for (const secret of ['another-secret', 'secret-password', 'test-sensitive-bot-token', 'key=private', 'request failed:']) {
        assert.ok(!output[0].includes(secret));
    }
});

test('INFO remains visible by default while TRACE and DEBUG are opt-in', t => {
    setEnvironment(t, 'LOG_LEVEL', 'INFO');
    const output = [];
    const log = createLogger('test', { sink: line => output.push(line) });
    log.trace('item_visited');
    log.debug('decision');
    log.info('completed', { count: 0 });
    assert.equal(output.length, 1);
    assert.match(output[0], /count=0/);

    // Verbose mode exposes both diagnostic levels without hiding normal milestones.
    process.env.LOG_LEVEL = 'TRACE';
    log.trace('item_visited');
    log.debug('decision');
    assert.equal(output.length, 3);
});

test('failed notifications emit an error without claiming successful delivery', async t => {
    const output = [];
    t.mock.method(console, 'log', line => output.push(line));
    t.mock.method(console, 'error', line => output.push(line));
    const notifications = require('../src/core/notify');
    notifications.init({ channels: { fetch: async () => ({ send: async () => {
        throw new Error('failed to send using secret credentials');
    } }) } });

    await assert.rejects(notifications.notify('destination', { title: 'Test' }), /failed to send/);

    assert.ok(output.some(line => line.includes('[ERROR]') && line.includes('delivery_failed')));
    assert.ok(!output.some(line => line.includes('delivery_completed')));
    assert.ok(!output.some(line => line.includes('secret credentials')));
});

test('scheduler catches failed jobs, reports retry timing, and omits success for that run', async t => {
    const cron = require('node-cron');
    let runJob;
    const output = [];
    t.mock.method(cron, 'schedule', (_schedule, task) => { runJob = task; });
    t.mock.method(console, 'log', line => output.push(line));
    t.mock.method(console, 'error', line => output.push(line));
    const { registerJob } = require('../src/core/scheduler');

    // A rejected job must not escape its callback or announce a successful completion.
    registerJob('0 * * * *', async () => { throw new Error('temporary failure'); }, 'youtube:uploads');
    await runJob();

    assert.ok(output.some(line => line.includes('job_failed') && line.includes('next_scheduled_run')));
    assert.ok(!output.some(line => line.includes('job_completed')));
});

test('database logs distinguish disconnection and recovery without adding duplicate listeners', async t => {
    const db = require('../src/core/db');
    const output = [];
    t.mock.method(console, 'log', line => output.push(line));
    t.mock.method(console, 'warn', line => output.push(line));
    t.mock.method(db.mongoose, 'connect', async () => {});

    // Calling connect twice must not attach a second set of lifecycle listeners.
    await db.connect();
    const listenerCount = db.mongoose.connection.listenerCount('connected');
    await db.connect();
    assert.equal(db.mongoose.connection.listenerCount('connected'), listenerCount);
    db.mongoose.connection.emit('disconnected');
    db.mongoose.connection.emit('reconnected');

    assert.ok(output.some(line => line.includes('[WARN]') && line.includes('db:disconnected')));
    assert.ok(output.some(line => line.includes('[INFO]') && line.includes('db:reconnected')));
});

test('failed YouTube API calls expose the endpoint and HTTP code without logging success or the API key', async () => {
    const { createUploadChecker } = require('../src/modules/youtube/uploads');
    const output = [];
    const check = createUploadChecker({
        apiKey: 'private-youtube-key', channelId: 'test-channel', destination: 'destination',
        db: { getState: async () => ({ initialized: true, seen: [], pending: [] }) },
        notify: async () => assert.fail('No notification should be sent after an API failure'),
        log: line => output.push(line),
        fetchImpl: async url => url.includes('/xml/feeds/')
            ? { ok: true, text: async () => '<feed><yt:videoId>upload00001</yt:videoId></feed>' }
            : { ok: false, status: 403 },
    });

    // A valid feed followed by a rejected metadata request must remain visibly unsuccessful.
    await assert.rejects(check(), /403/);

    assert.ok(output.some(line => line.includes('resource="videos"') && line.includes('HTTP_403')));
    assert.ok(!output.some(line => line.includes('api_request_completed') || line.includes('check_completed')));
    assert.ok(!output.some(line => line.includes('private-youtube-key')));
});
