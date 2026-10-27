const crypto = require('crypto');
const { REST, Routes } = require('discord.js');
const { getState, setState } = require('./db');
const { createLogger, safeError } = require('./logger');
const log = createLogger('commands');

function hashCommands(commandsJson) {
    return crypto.createHash('sha256').update(JSON.stringify(commandsJson)).digest('hex');
}

async function deployIfChanged(commands, clientId, token) {
    try {
        const commandsJson = commands.map(c => c.data.toJSON());
        const currentHash = hashCommands(commandsJson);
        const storedHash = await getState('core', 'commandHash');

        if (currentHash === storedHash) {
            // INFO for normal no-change startup; count is the number of loaded definitions.
            log.info('registration_skipped', { reason: 'unchanged', count: commandsJson.length });
            return;
        }

        const rest = new REST({ version: '10' }).setToken(token);
        // INFO before the Discord registration request; token and full payload are excluded.
        log.info('registration_started', { count: commandsJson.length });
        await rest.put(Routes.applicationCommands(clientId), { body: commandsJson });
        await setState('core', 'commandHash', currentHash);
        // INFO after registration and hash persistence both succeed.
        log.info('registration_completed', { count: commandsJson.length });
    } catch (error) {
        // ERROR if Discord registration or persistence fails; propagate so startup can report its outcome.
        log.error('registration_failed', { ...safeError(error), nextAction: 'abort_initialization' });
        throw error;
    }
}

module.exports = { deployIfChanged };
