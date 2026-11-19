const { test } = require('node:test');

const assert = require('node:assert/strict');

const { createHighlightJobs } = require('../src/highlights/scheduling');

const store = require('../src/highlights/store');

test('disabled highlights register no processing or delivery jobs', () => {
    const jobs = createHighlightJobs({ env: {}, notify: () => assert.fail('Unexpected delivery') });

    assert.deepEqual(jobs, []);
});

test('Heroku schedules selection and delivery separately without a Railway benchmark flag', async t => {
    const env = { HIGHLIGHTS_ENABLED: 'true' };

    const calls = [];

    const notify = async () => {};

    t.mock.method(store, 'deliverCompleted', async sender => {
        assert.equal(sender, notify);

        calls.push('delivery');
    });

    const jobs = createHighlightJobs({ env, notify, process: async received => {
        assert.equal(received, env);

        calls.push('selection');
    } });

    assert.deepEqual(jobs.map(job => [job.label, job.schedule]), [
        ['highlight-processing', '*/15 * * * *'],
        ['highlight-links', '*/5 * * * *'],
    ]);

    await jobs[0].task();

    await jobs[1].task();

    assert.deepEqual(calls, ['selection', 'delivery']);
});

test('overlapping Heroku selection ticks skip duplicate work and resume after completion', async () => {
    let finish;

    let calls = 0;

    const pending = new Promise(resolve => { finish = resolve; });

    const jobs = createHighlightJobs({ env: { HIGHLIGHTS_ENABLED: 'true' }, process: async () => {
        calls++;

        await pending;
    } });

    // Keep the first run open while the scheduler invokes another tick.
    const first = jobs[0].task();

    await jobs[0].task();

    assert.equal(calls, 1);

    finish();

    await first;

    await jobs[0].task();

    assert.equal(calls, 2);
});

test('processing failures release the overlap guard and do not prevent ready-link delivery', async t => {
    let calls = 0;

    let deliveries = 0;

    t.mock.method(store, 'deliverCompleted', async () => { deliveries++; });

    const jobs = createHighlightJobs({ env: { HIGHLIGHTS_ENABLED: 'true' }, process: async () => {
        calls++;

        if (calls === 1) throw new Error('OpenRouter unavailable');
    } });

    await assert.rejects(jobs[0].task(), /OpenRouter unavailable/);

    // The scheduler catches the rejection; its independent delivery job can still run.
    await jobs[1].task();

    await jobs[0].task();

    assert.equal(deliveries, 1);

    assert.equal(calls, 2);
});
