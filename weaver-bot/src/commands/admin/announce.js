const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// Announcement Command
module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Announcement message')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to send to (defaults to current)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Embed color')
                .addChoices(
                    { name: 'Blue', value: 'Blue' },
                    { name: 'Green', value: 'Green' },
                    { name: 'Red', value: 'Red' },
                    { name: 'Yellow', value: 'Yellow' }
                )
                .setRequired(false)
        ),
    
    // Execute announcement
    async execute(interaction) {
        const message = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const colorChoice = interaction.options.getString('color') || 'Blue';

        const colors = {
            'Blue': 0x0099FF,
            'Green': 0x00FF00,
            'Red': 0xFF0000,
            'Yellow': 0xFFFF00
        };

        const embed = new EmbedBuilder()
            .setTitle('📢 Announcement')
            .setDescription(message)
            .setColor(colors[colorChoice])
            .setTimestamp()
            .setFooter({ text: `By ${interaction.user.tag}` });

        try {
            await channel.send({ embeds: [embed] });
            await interaction.reply({
                content: `✅ Announcement sent to ${channel}`,
                ephemeral: true
            });
        } catch (error) {
            await interaction.reply({
                content: '❌ Failed to send announcement.',
                ephemeral: true
            });
        }
    }
};