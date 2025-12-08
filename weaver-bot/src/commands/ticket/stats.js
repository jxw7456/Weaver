const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Command to view ticket statistics
module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticketstats')
        .setDescription('View ticket statistics.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('View stats for a specific user.')
                .setRequired(false)
        ),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        
        try {
            let where = { guildId: interaction.guild.id };
            if (targetUser) {
                where.userId = targetUser.id;
            }

            // Get ticket counts
            const totalTickets = await prisma.ticket.count({ where });
            const openTickets = await prisma.ticket.count({ where: { ...where, status: 'open' } });
            const closedTickets = await prisma.ticket.count({ where: { ...where, status: 'closed' } });

            // Get average rating
            const feedbacks = await prisma.feedback.findMany({
                where: {
                    ticket: where
                }
            });

            const avgRating = feedbacks.length > 0
                ? (feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length).toFixed(2)
                : 'N/A';

            // Get category breakdown
            const categories = await prisma.ticket.groupBy({
                by: ['category'],
                where,
                _count: true
            });

            const categoryText = categories
                .map(c => `**${c.category}**: ${c._count}`)
                .join('\n') || 'No tickets yet.';

            const embed = new EmbedBuilder()
                .setTitle(`📊 Ticket Statistics${targetUser ? ` - ${targetUser.tag}` : ''}`)
                .addFields(
                    { name: '📝 Total Tickets', value: totalTickets.toString(), inline: true },
                    { name: '🟢 Open Tickets', value: openTickets.toString(), inline: true },
                    { name: '🔴 Closed Tickets', value: closedTickets.toString(), inline: true },
                    { name: '⭐ Average Rating', value: avgRating.toString(), inline: true },
                    { name: '📋 Category Breakdown', value: categoryText }
                )
                .setColor(0x00AE86)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error('Error fetching ticket stats:', error);
            await interaction.editReply({
                content: '❌ Failed to fetch ticket statistics.'
            });
        }
    }
};