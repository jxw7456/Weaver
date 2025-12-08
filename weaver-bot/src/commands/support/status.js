const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const logger = require('../../utils/logger');

const prisma = new PrismaClient();

// Status Command
module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check bot and support system status'),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Get system stats
            const uptime = process.uptime();
            const memoryUsage = process.memoryUsage();
            
            // Database stats
            const openTickets = await prisma.ticket.count({ where: { status: 'open' } });
            const totalTickets = await prisma.ticket.count();
            const totalFAQs = await prisma.fAQ.count();
            
            // Calculate response times (last 24h)
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentTickets = await prisma.ticket.findMany({
                where: {
                    createdAt: { gte: yesterday },
                    closedAt: { not: null }
                }
            });

            const avgResponseTime = recentTickets.length > 0
                ? recentTickets.reduce((sum, t) => {
                    return sum + (new Date(t.closedAt) - new Date(t.createdAt));
                }, 0) / recentTickets.length
                : 0;

            const embed = new EmbedBuilder()
                .setTitle('📊 Bot Status')
                .addFields(
                    { 
                        name: '🤖 Bot Information', 
                        value: `**Uptime:** ${formatUptime(uptime)}\n**Memory:** ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB\n**Ping:** ${interaction.client.ws.ping}ms`
                    },
                    { 
                        name: '🎫 Ticket System', 
                        value: `**Open:** ${openTickets}\n**Total:** ${totalTickets}\n**Avg Response Time (24h):** ${formatDuration(avgResponseTime)}`,
                        inline: true
                    },
                    { 
                        name: '📚 FAQ System', 
                        value: `**Total FAQs:** ${totalFAQs}\n**Categories:** ${await getCategories()}`,
                        inline: true
                    },
                    {
                        name: '🟢 System Status',
                        value: 'All systems operational'
                    }
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: `Weaver Bot v1.0` });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error('Error fetching status:', error);
            await interaction.editReply({
                content: '❌ Error fetching system status.'
            });
        }
    }
};

// Format uptime from seconds to human-readable
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

// Format duration from milliseconds to human-readable
function formatDuration(ms) {
    if (ms === 0) return 'N/A';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Get number of FAQ categories
async function getCategories() {
    const categories = await prisma.fAQ.groupBy({
        by: ['category'],
        _count: true
    });
    return categories.length;
}