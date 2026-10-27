require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, MessageFlags } = require('discord.js');
const path = require('path');
const fs = require('fs');

const db = require('./core/db');
const notify = require('./core/notify');
const { deployIfChanged } = require('./core/deployCommands');
const { loadModules } = require('./core/moduleLoader');
const webhookServer = require('./core/webhookServer');
const { createLogger, safeError } = require('./core/logger');
const log = createLogger('bot');

// INFO once per process start; pid and Node version distinguish restarts from DB reconnections.
log.info('process_started', { pid: process.pid, node: process.version });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

client.commands = new Collection();

function loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath, { recursive: true }).filter(f => f.endsWith('.js'));
    for (const file of commandFiles) {
        // TRACE before loading an individual export; file identifies the command or helper under inspection.
        log.trace('command_file_loading', { file });
        const command = require(path.join(commandsPath, file));
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            // WARN for a non-command file in the scanned directory; file identifies the skipped export.
            log.warn('command_file_skipped', { file, reason: 'missing_data_or_execute' });
        }
    }
    // INFO after all command definitions load successfully; count excludes skipped helper files.
    log.info('commands_loaded', { count: client.commands.size });
}

client.once('ready', async (c) => {
    try {
        // INFO when the Discord gateway is ready; botId identifies the connected application.
        log.info('discord_ready', { botId: c.user.id });

        loadModules(client);
        notify.init(client);
        webhookServer.start();

        await deployIfChanged([...client.commands.values()], process.env.CLIENT_ID, process.env.DISCORD_TOKEN);

        // INFO after integration initialization and command registration finish.
        log.info('startup_completed', { commands: client.commands.size });
    } catch (error) {
        // CRITICAL when ready-time initialization fails; the service exits for host-managed recovery.
        log.critical('initialization_failed', { ...safeError(error), nextAction: 'stop_service' });
        process.exit(1);
    }
});

client.on('error', error => {
    // ERROR on a Discord client fault; the library retains responsibility for reconnection.
    log.error('discord_error', { ...safeError(error), nextAction: 'inspect_gateway' });
});
client.on('shardReconnecting', shardId => {
    // WARN while a gateway shard is recovering; shardId identifies the affected connection.
    log.warn('discord_reconnecting', { shardId });
});
client.on('shardResume', shardId => {
    // INFO when Discord resumes an interrupted shard session.
    log.info('discord_resumed', { shardId });
});

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    if (msg.content.toLowerCase() === 'hello') {
        try {
            await msg.reply('hi');
            // DEBUG after the greeting is delivered; message contents are omitted.
            log.debug('greeting_delivered');
        } catch (error) {
            // ERROR for a failed greeting; this isolated reply does not stop the bot.
            log.error('greeting_failed', { ...safeError(error), nextAction: 'skip_reply' });
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) {
        // WARN when Discord invokes a definition unavailable in this process.
        log.warn('command_unavailable', { command: interaction.commandName, nextAction: 'skip_command' });
        return;
    }

    try {
        // INFO before running a slash command; only its name is recorded, never user options.
        log.info('command_started', { command: interaction.commandName });
        await command.execute(interaction);
        // INFO only after the command execution resolves.
        log.info('command_completed', { command: interaction.commandName });
    } catch (error) {
        // ERROR for command execution failure; attempt a private error response without stopping the bot.
        log.error('command_failed', { command: interaction.commandName, ...safeError(error), nextAction: 'error_reply' });
        const errorMsg = { content: 'Something went wrong executing that command.', flags: MessageFlags.Ephemeral };
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp(errorMsg);
            else await interaction.reply(errorMsg);
        } catch (replyError) {
            // ERROR if the fallback message also fails; prevent an unhandled rejection.
            log.error('error_reply_failed', { ...safeError(replyError), nextAction: 'skip_reply' });
        }
    }
});

(async () => {
    loadCommands();
    await db.connect();
    // INFO before establishing Discord connectivity; the bot token is never included.
    log.info('discord_login_started');
    await client.login(process.env.DISCORD_TOKEN);
})().catch(error => {
    // CRITICAL on boot failure, including missing environment variables; no raw URI or stack is emitted.
    log.critical('startup_failed', { ...safeError(error), nextAction: 'stop_service' });
    process.exit(1);
});
