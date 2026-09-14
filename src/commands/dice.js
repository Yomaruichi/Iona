const { SlashCommandBuilder } = require('discord.js');
const { dice } = require('./gambling.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Roll some dice')
        .addIntegerOption(option =>
            option
                .setName('pieces')
                .setDescription('Number of dice to roll')
                .setRequired(true)
                .setMinValue(1)
        )
        .addIntegerOption(option =>
            option
                .setName('sides')
                .setDescription('Number of sides on each die')
                .setRequired(true)
                .setMinValue(2)
        ),

    async execute(interaction) {
        const pieces = interaction.options.getInteger('pieces');
        const sides = interaction.options.getInteger('sides');
        await interaction.reply(
            `**Pieces:** ${pieces}\n**Sides:** ${sides}\n**You rolled:** ${dice(pieces, sides)}`
        );
    },
};