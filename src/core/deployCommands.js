const crypto = require('crypto');
const { REST, Routes } = require('discord.js');
const { getState, setState } = require('./db');

function hashCommands(commandsJson) {
    return crypto.createHash('sha256').update(JSON.stringify(commandsJson)).digest('hex');
}

async function deployIfChanged(commands, clientId, token) {
    const commandsJson = commands.map(c => c.data.toJSON());
    const currentHash = hashCommands(commandsJson);
    const storedHash = await getState('core', 'commandHash');

    if (currentHash === storedHash) {
        console.log('Commands unchanged, skipping Discord registration');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationCommands(clientId), { body: commandsJson });
    await setState('core', 'commandHash', currentHash);
    console.log(`Registered ${commandsJson.length} command(s) globally`);
}

module.exports = { deployIfChanged };