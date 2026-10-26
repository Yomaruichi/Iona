const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/core/db');
const { REST } = require('discord.js');

test('command registration saves successful changes, skips unchanged definitions, and leaves failed changes unsaved', async t => {
    // Replace MongoDB and Discord calls with an in-memory record of their effects.
    let storedHash = null;
    const discordRequests = [];
    const stateWrites = [];
    t.mock.method(db, 'getState', async () => storedHash);
    t.mock.method(db, 'setState', async (moduleName, key, value) => {
        stateWrites.push({ moduleName, key, value });
        storedHash = value;
    });
    const discordPut = t.mock.method(REST.prototype, 'put', async (route, payload) => {
        discordRequests.push({ route, payload });
    });
    // Load after installing mocks because this module captures database functions on import.
    const { deployIfChanged } = require('../src/core/deployCommands');
    const commands = [{ data: { toJSON: () => ({ name: 'dice', description: 'Roll dice' }) } }];
    // First registration sends the definitions to Discord and saves their hash.
    await deployIfChanged(commands, '123', 'test-token');
    assert.equal(discordRequests.length, 1);
    assert.equal(discordRequests[0].route, '/applications/123/commands');
    assert.deepEqual(discordRequests[0].payload.body, [{ name: 'dice', description: 'Roll dice' }]);
    assert.equal(stateWrites[0].moduleName, 'core');
    assert.equal(stateWrites[0].key, 'commandHash');

    // A second deployment with identical definitions must do no additional work.
    await deployIfChanged(commands, '123', 'test-token');
    assert.equal(discordRequests.length, 1);
    assert.equal(stateWrites.length, 1);

    // Force another registration and simulate an outage so a later retry remains possible.
    storedHash = null;
    discordPut.mock.mockImplementation(async () => { throw new Error('Discord unavailable'); });
    await assert.rejects(deployIfChanged(commands, '123', 'test-token'), /Discord unavailable/);
    assert.equal(stateWrites.length, 1);
});
