require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, MessageFlags } = require('discord.js');
const path = require('path');
const fs = require('fs');

const db = require('./core/db');
const notify = require('./core/notify');
const { deployIfChanged } = require('./core/deployCommands');
const { loadModules } = require('./core/moduleLoader');
const webhookServer = require('./core/webhookServer');

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

// Load existing flat/recursive commands folder — unchanged from before
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath, { recursive: true }).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.warn(`[WARNING] ${file} is missing "data" or "execute"`);
    }
}

client.once('ready', async (c) => {
    console.log(`Logged in as ${c.user.tag}`);

    loadModules(client);              // pulls in any /modules, adds their commands too
    notify.init(client);              // now every module can call notify()
    webhookServer.start();            // one HTTP server for all incoming webhooks

    await deployIfChanged([...client.commands.values()], process.env.CLIENT_ID, process.env.DISCORD_TOKEN);

    console.log(`Loaded ${client.commands.size} command(s) total`);
});

client.on('messageCreate', (msg) => {
    if (msg.author.bot) return;
    if (msg.content.toLowerCase() === 'hello') msg.reply('hi');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return console.error(`No command found for: ${interaction.commandName}`);

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing /${interaction.commandName}:`, error);
        const errorMsg = { content: 'Something went wrong executing that command.', flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(errorMsg);
        else await interaction.reply(errorMsg);
    }
});

(async () => {
    await db.connect();
    await client.login(process.env.DISCORD_TOKEN);
})();