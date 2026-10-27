const { test } = require('node:test');
const assert = require('node:assert/strict');

test('module registration handles omitted capabilities and registers configured commands, routes, and jobs', t => {
    const webhooks = require('../src/core/webhookServer');
    const scheduler = require('../src/core/scheduler');
    const routes = [];
    const jobs = [];
    t.mock.method(webhooks, 'registerRoute', (...args) => routes.push(args));
    t.mock.method(scheduler, 'registerJob', (...args) => jobs.push(args));
    // Import after mocks so registration never opens a socket or starts a real timer.
    const { registerModule } = require('../src/core/moduleLoader');
    const client = { commands: new Map() };
    registerModule(client, { name: 'empty' });
    assert.equal(client.commands.size, 0);
    assert.equal(routes.length, 0);
    assert.equal(jobs.length, 0);

    const command = { data: { name: 'status' }, execute() {} };
    const handler = () => {};
    const task = () => {};
    registerModule(client, {
        name: 'integration', commands: [command],
        webhookRoutes: [{ path: '/event', handler }],
        cronJobs: [{ schedule: '0 * * * *', task }],
    });

    assert.equal(client.commands.get('status'), command);
    assert.deepEqual(routes, [['/event', [], handler]]);
    assert.deepEqual(jobs, [['0 * * * *', task, 'integration:job']]);
});
