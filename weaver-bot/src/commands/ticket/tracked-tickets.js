const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const logger = require('../../utils/logger');

const prisma = new PrismaClient();

// Command to manage tracked tickets for review
module.exports = {
    data: new SlashCommandBuilder()
        .setName('tracked-tickets')
        .setDescription('Manage tickets tracked for review')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all tracked tickets')
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('Filter by status')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Pending', value: 'pending' },
                            { name: 'In Review', value: 'in_review' },
                            { name: 'Resolved', value: 'resolved' },
                            { name: 'Exported to Notion', value: 'exported' },
                            { name: 'All', value: 'all' }
                        )
                )
                .addStringOption(option =>
                    option.setName('priority')
                        .setDescription('Filter by priority')
                        .setRequired(false)
                        .addChoices(
                            { name: '🔴 Urgent', value: 'urgent' },
                            { name: '🟠 High', value: 'high' },
                            { name: '🟡 Normal', value: 'normal' },
                            { name: '🟢 Low', value: 'low' }
                        )
                )
                .addStringOption(option =>
                    option.setName('sort')
                        .setDescription('Sort order')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Priority (Urgent first)', value: 'priority' },
                            { name: 'Rating (Lowest first)', value: 'rating_asc' },
                            { name: 'Rating (Highest first)', value: 'rating_desc' },
                            { name: 'Oldest first', value: 'oldest' },
                            { name: 'Newest first', value: 'newest' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View details of a tracked ticket')
                .addIntegerOption(option =>
                    option.setName('ticket_id')
                        .setDescription('The ticket ID to view')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('update')
                .setDescription('Update a tracked ticket status')
                .addIntegerOption(option =>
                    option.setName('ticket_id')
                        .setDescription('The ticket ID to update')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('New status')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Pending', value: 'pending' },
                            { name: 'In Review', value: 'in_review' },
                            { name: 'Resolved', value: 'resolved' },
                            { name: 'Ready for Export', value: 'exported' }
                        )
                )
                .addStringOption(option =>
                    option.setName('notes')
                        .setDescription('Add review notes')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a ticket from tracking')
                .addIntegerOption(option =>
                    option.setName('ticket_id')
                        .setDescription('The ticket ID to remove')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View tracking statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('export-ready')
                .setDescription('List tickets ready for Notion export')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('export')
                .setDescription('Export a ticket to Notion')
                .addIntegerOption(option =>
                    option.setName('ticket_id')
                        .setDescription('The ticket ID to export')
                        .setRequired(true)
                )
        ),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'list':
                await handleList(interaction);
                break;
            case 'view':
                await handleView(interaction);
                break;
            case 'update':
                await handleUpdate(interaction);
                break;
            case 'remove':
                await handleRemove(interaction);
                break;
            case 'stats':
                await handleStats(interaction);
                break;
            case 'export-ready':
                await handleExportReady(interaction);
                break;
            case 'export':
                await handleExport(interaction);
                break;
        }
    }
};

// Priority emoji and order mapping
const priorityEmoji = { urgent: '🔴', high: '🟠', normal: '🟡', low: '🟢' };
const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

// List tracked tickets with filters and sorting
async function handleList(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const statusFilter = interaction.options.getString('status') || 'all';
        const priorityFilter = interaction.options.getString('priority');
        const sortBy = interaction.options.getString('sort') || 'priority';

        // Build where clause
        const where = {};
        if (statusFilter !== 'all') {
            where.status = statusFilter;
        }
        if (priorityFilter) {
            where.priority = priorityFilter;
        }

        // Determine sort order
        let orderBy = [];
        switch (sortBy) {
            case 'priority':
                orderBy = [{ priority: 'asc' }, { rating: 'asc' }];
                break;
            case 'rating_asc':
                orderBy = [{ rating: 'asc' }];
                break;
            case 'rating_desc':
                orderBy = [{ rating: 'desc' }];
                break;
            case 'oldest':
                orderBy = [{ createdAt: 'asc' }];
                break;
            case 'newest':
                orderBy = [{ createdAt: 'desc' }];
                break;
        }

        const trackedTickets = await prisma.trackedTicket.findMany({
            where,
            orderBy,
            take: 25
        });

        if (trackedTickets.length === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📑 Tracked Tickets')
                        .setDescription('No tracked tickets found with the specified filters.')
                        .setColor(0x00AE86)
                ]
            });
        }

        // Fetch associated tickets
        const ticketIds = trackedTickets.map(t => t.ticketId);
        const tickets = await prisma.ticket.findMany({
            where: { id: { in: ticketIds } },
            include: { feedback: true }
        });
        const ticketMap = new Map(tickets.map(t => [t.id, t]));

        // Sort by priority manually for display
        const sortedTracked = sortBy === 'priority' 
            ? trackedTickets.sort((a, b) => {
                if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                    return priorityOrder[a.priority] - priorityOrder[b.priority];
                }
                return a.rating - b.rating;
            })
            : trackedTickets;

        const ticketList = sortedTracked.slice(0, 15).map((tracked, i) => {
            const t = ticketMap.get(tracked.ticketId);
            if (!t) return null;
            
            const statusIcon = {
                pending: '⏳',
                in_review: '🔍',
                resolved: '✅',
                exported: '📤'
            };

            return `${priorityEmoji[tracked.priority]} **#${t.id}** ${statusIcon[tracked.status] || '❓'}\n` +
                   `└ ${getStarRating(tracked.rating)} | ${t.subject.substring(0, 30)}${t.subject.length > 30 ? '...' : ''}\n` +
                   `└ 📁 ${t.category} | [View Thread](https://discord.com/channels/${t.guildId}/${t.channelId})`;
        }).filter(Boolean).join('\n\n');

        const filterDesc = [];
        if (statusFilter !== 'all') filterDesc.push(`Status: ${statusFilter}`);
        if (priorityFilter) filterDesc.push(`Priority: ${priorityFilter}`);

        const embed = new EmbedBuilder()
            .setTitle('📑 Tracked Tickets')
            .setDescription(
                (filterDesc.length > 0 ? `**Filters:** ${filterDesc.join(', ')}\n\n` : '') +
                `Found **${trackedTickets.length}** tracked ticket(s)\n\n` +
                ticketList
            )
            .setColor(0x00AE86)
            .setTimestamp();

        if (sortedTracked.length > 15) {
            embed.setFooter({ text: `Showing 15 of ${sortedTracked.length} tickets` });
        }

        // Add filter buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('tracked_filter_urgent')
                    .setLabel('Urgent Only')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔴'),
                new ButtonBuilder()
                    .setCustomId('tracked_filter_lowrating')
                    .setLabel('Low Ratings')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⭐')
            );

        await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
        logger.error('Error listing tracked tickets:', error);
        await interaction.editReply({
            content: '❌ Error fetching tracked tickets.'
        });
    }
}

// View detailed info about a tracked ticket
async function handleView(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const ticketId = interaction.options.getInteger('ticket_id');

        const tracked = await prisma.trackedTicket.findUnique({
            where: { ticketId }
        });

        if (!tracked) {
            return interaction.editReply({
                content: `❌ Ticket #${ticketId} is not being tracked.`
            });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { feedback: true }
        });

        if (!ticket) {
            return interaction.editReply({
                content: `❌ Ticket #${ticketId} not found.`
            });
        }

        const statusIcon = {
            pending: '⏳ Pending Review',
            in_review: '🔍 In Review',
            resolved: '✅ Resolved',
            exported: '📤 Exported to Notion'
        };

        const embed = new EmbedBuilder()
            .setTitle(`📋 Tracked Ticket #${ticketId}`)
            .setDescription(`**Subject:** ${ticket.subject}`)
            .addFields(
                { name: '📁 Category', value: ticket.category, inline: true },
                { name: '⭐ Rating', value: ticket.feedback ? getStarRating(ticket.feedback.rating) : 'No feedback', inline: true },
                { name: `${priorityEmoji[tracked.priority]} Priority`, value: tracked.priority.charAt(0).toUpperCase() + tracked.priority.slice(1), inline: true },
                { name: '📊 Status', value: statusIcon[tracked.status] || tracked.status, inline: true },
                { name: '👤 User', value: `<@${ticket.userId}>`, inline: true },
                { name: '👨‍💼 Assigned To', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'Unassigned', inline: true },
                { name: '📝 Tracked By', value: `<@${tracked.trackedBy}>`, inline: true },
                { name: '📅 Tracked On', value: `<t:${Math.floor(tracked.createdAt.getTime() / 1000)}:R>`, inline: true },
                { name: '🔗 Thread', value: `[Open Thread](https://discord.com/channels/${ticket.guildId}/${ticket.channelId})`, inline: true }
            )
            .setColor(getRatingColor(ticket.feedback?.rating || 3))
            .setTimestamp();

        if (tracked.notes) {
            embed.addFields({ name: '📝 Review Notes', value: tracked.notes });
        }

        if (ticket.feedback?.comment) {
            embed.addFields({ name: '💬 User Feedback', value: ticket.feedback.comment.substring(0, 1024) });
        }

        if (tracked.notionPageId) {
            embed.addFields({ 
                name: '📓 Notion', 
                value: `[View in Notion](https://notion.so/${tracked.notionPageId})` 
            });
        }

        // Action buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`tracked_status_${ticketId}_in_review`)
                    .setLabel('Mark In Review')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(tracked.status === 'in_review'),
                new ButtonBuilder()
                    .setCustomId(`tracked_status_${ticketId}_resolved`)
                    .setLabel('Mark Resolved')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(tracked.status === 'resolved'),
                new ButtonBuilder()
                    .setURL(`https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`)
                    .setLabel('Go to Thread')
                    .setStyle(ButtonStyle.Link)
            );

        await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
        logger.error('Error viewing tracked ticket:', error);
        await interaction.editReply({
            content: '❌ Error fetching ticket details.'
        });
    }
}

// Update ticket status and add notes
async function handleUpdate(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const ticketId = interaction.options.getInteger('ticket_id');
        const newStatus = interaction.options.getString('status');
        const notes = interaction.options.getString('notes');

        const tracked = await prisma.trackedTicket.findUnique({
            where: { ticketId }
        });

        if (!tracked) {
            return interaction.editReply({
                content: `❌ Ticket #${ticketId} is not being tracked.`
            });
        }

        const updateData = {
            status: newStatus,
            reviewedBy: interaction.user.id,
            updatedAt: new Date()
        };

        if (notes) {
            updateData.notes = tracked.notes 
                ? `${tracked.notes}\n\n[${new Date().toISOString()}] ${notes}`
                : notes;
        }

        await prisma.trackedTicket.update({
            where: { ticketId },
            data: updateData
        });

        const statusIcon = {
            pending: '⏳',
            in_review: '🔍',
            resolved: '✅',
            exported: '📤'
        };

        const embed = new EmbedBuilder()
            .setTitle('✅ Ticket Updated')
            .setDescription(`Ticket #${ticketId} has been updated.`)
            .addFields(
                { name: 'New Status', value: `${statusIcon[newStatus]} ${newStatus.replace('_', ' ').charAt(0).toUpperCase() + newStatus.slice(1).replace('_', ' ')}`, inline: true },
                { name: 'Updated By', value: `${interaction.user}`, inline: true }
            )
            .setColor(0x00FF00)
            .setTimestamp();

        if (notes) {
            embed.addFields({ name: 'Notes Added', value: notes });
        }

        await interaction.editReply({ embeds: [embed] });

        logger.info(`Tracked ticket ${ticketId} updated to ${newStatus} by ${interaction.user.tag}`);

    } catch (error) {
        logger.error('Error updating tracked ticket:', error);
        await interaction.editReply({
            content: '❌ Error updating ticket.'
        });
    }
}

// Remove ticket from tracking
async function handleRemove(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const ticketId = interaction.options.getInteger('ticket_id');

        const tracked = await prisma.trackedTicket.findUnique({
            where: { ticketId }
        });

        if (!tracked) {
            return interaction.editReply({
                content: `❌ Ticket #${ticketId} is not being tracked.`
            });
        }

        await prisma.trackedTicket.delete({
            where: { ticketId }
        });

        await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                tracked: false,
                trackedAt: null,
                trackedBy: null
            }
        });

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🗑️ Ticket Removed from Tracking')
                    .setDescription(`Ticket #${ticketId} is no longer being tracked.`)
                    .setColor(0xFF9800)
                    .setTimestamp()
            ]
        });

        logger.info(`Ticket ${ticketId} removed from tracking by ${interaction.user.tag}`);

    } catch (error) {
        logger.error('Error removing tracked ticket:', error);
        await interaction.editReply({
            content: '❌ Error removing ticket from tracking.'
        });
    }
}

// Show tracking statistics
async function handleStats(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const allTracked = await prisma.trackedTicket.findMany();
        
        const stats = {
            total: allTracked.length,
            pending: allTracked.filter(t => t.status === 'pending').length,
            inReview: allTracked.filter(t => t.status === 'in_review').length,
            resolved: allTracked.filter(t => t.status === 'resolved').length,
            exported: allTracked.filter(t => t.status === 'exported').length,
            urgent: allTracked.filter(t => t.priority === 'urgent').length,
            high: allTracked.filter(t => t.priority === 'high').length,
            avgRating: allTracked.length > 0 
                ? (allTracked.reduce((sum, t) => sum + t.rating, 0) / allTracked.length).toFixed(2)
                : 'N/A',
            lowRated: allTracked.filter(t => t.rating <= 2).length
        };

        // Get this week's tracking activity
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const thisWeek = allTracked.filter(t => t.createdAt >= weekAgo).length;

        const embed = new EmbedBuilder()
            .setTitle('📊 Tracking Statistics')
            .addFields(
                { name: '📑 Total Tracked', value: stats.total.toString(), inline: true },
                { name: '📅 This Week', value: thisWeek.toString(), inline: true },
                { name: '⭐ Avg Rating', value: stats.avgRating.toString(), inline: true },
                { name: '\u200B', value: '**By Status:**', inline: false },
                { name: '⏳ Pending', value: stats.pending.toString(), inline: true },
                { name: '🔍 In Review', value: stats.inReview.toString(), inline: true },
                { name: '✅ Resolved', value: stats.resolved.toString(), inline: true },
                { name: '📤 Exported', value: stats.exported.toString(), inline: true },
                { name: '\u200B', value: '**Priority Breakdown:**', inline: false },
                { name: '🔴 Urgent', value: stats.urgent.toString(), inline: true },
                { name: '🟠 High', value: stats.high.toString(), inline: true },
                { name: '⭐ Low Rated (1-2)', value: stats.lowRated.toString(), inline: true }
            )
            .setColor(0x00AE86)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        logger.error('Error fetching tracking stats:', error);
        await interaction.editReply({
            content: '❌ Error fetching statistics.'
        });
    }
}

// List tickets ready for Notion export
async function handleExportReady(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const exportReady = await prisma.trackedTicket.findMany({
            where: {
                OR: [
                    { status: 'exported', notionPageId: null },
                    { status: 'resolved' }
                ]
            },
            orderBy: { updatedAt: 'desc' }
        });

        if (exportReady.length === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📤 Export Ready Tickets')
                        .setDescription('No tickets are currently ready for Notion export.\n\nMark tickets as "Resolved" or "Ready for Export" to see them here.')
                        .setColor(0x00AE86)
                ]
            });
        }

        const ticketIds = exportReady.map(t => t.ticketId);
        const tickets = await prisma.ticket.findMany({
            where: { id: { in: ticketIds } },
            include: { feedback: true }
        });
        const ticketMap = new Map(tickets.map(t => [t.id, t]));

        const ticketList = exportReady.map((tracked, i) => {
            const t = ticketMap.get(tracked.ticketId);
            if (!t) return null;
            return `**${i + 1}. #${t.id}** - ${t.subject.substring(0, 40)}${t.subject.length > 40 ? '...' : ''}\n` +
                   `└ ${getStarRating(tracked.rating)} | 📁 ${t.category}`;
        }).filter(Boolean).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle('📤 Tickets Ready for Notion Export')
            .setDescription(`**${exportReady.length}** ticket(s) ready to export\n\n${ticketList}`)
            .addFields({
                name: '📓 Export Options',
                value: '• Use `/tracked-tickets export <ticket_id>` to auto-export\n' +
                       '• Or [Open Notion Tracker](https://www.notion.so/discordapp/1ddf46fd48aa806e9693d3a0e8dd9238) for manual entry'
            })
            .setColor(0x00AE86)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        logger.error('Error fetching export-ready tickets:', error);
        await interaction.editReply({
            content: '❌ Error fetching tickets.'
        });
    }
}

// Export ticket to Notion
async function handleExport(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const ticketId = interaction.options.getInteger('ticket_id');
        const notionService = require('../../services/notionService');

        // Check if Notion is configured
        if (!notionService.isAvailable()) {
            // Generate manual export data instead
            const exportData = await notionService.generateExportData(ticketId);
            
            if (!exportData) {
                return interaction.editReply({
                    content: `❌ Ticket #${ticketId} not found or not being tracked.`
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`📋 Export Data for Ticket #${ticketId}`)
                .setDescription('Notion API not configured. Copy this data manually:')
                .addFields(
                    { name: 'Ticket ID Link', value: `[${exportData['Ticket ID Link']}](${exportData['Thread URL']})` },
                    { name: 'Domain', value: exportData['Domain'], inline: true },
                    { name: 'Priority', value: exportData['Priority'], inline: true },
                    { name: 'Added', value: exportData['Added'], inline: true },
                    { name: 'Ticket Summary', value: exportData['Ticket Summary'].substring(0, 1024) }
                )
                .setColor(0xFFA500)
                .setFooter({ text: 'Set NOTION_API_KEY to enable auto-export' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setURL('https://www.notion.so/discordapp/1ddf46fd48aa806e9693d3a0e8dd9238')
                        .setLabel('Open Notion Tracker')
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('📓')
                );

            return interaction.editReply({ embeds: [embed], components: [row] });
        }

        // Auto-export to Notion
        const result = await notionService.exportTicket(ticketId, interaction.user.id);

        if (result.success) {
            const embed = new EmbedBuilder()
                .setTitle('✅ Exported to Notion')
                .setDescription(`Ticket #${ticketId} has been exported successfully!`)
                .addFields(
                    { name: '📓 Notion Page', value: `[Open in Notion](${result.pageUrl})` }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setURL(result.pageUrl)
                        .setLabel('View in Notion')
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('📓')
                );

            await interaction.editReply({ embeds: [embed], components: [row] });
            logger.info(`Ticket ${ticketId} exported to Notion by ${interaction.user.tag}`);
        } else {
            await interaction.editReply({
                content: `❌ Failed to export: ${result.error}`
            });
        }

    } catch (error) {
        logger.error('Error exporting ticket:', error);
        await interaction.editReply({
            content: '❌ Error exporting ticket to Notion.'
        });
    }
}

// Helper functions
// Generate star rating string
function getStarRating(rating) {
    if (!rating) return '☆☆☆☆☆ (N/A)';
    const stars = '⭐'.repeat(rating);
    const empty = '☆'.repeat(5 - rating);
    return `${stars}${empty} (${rating}/5)`;
}

// Get color based on rating
function getRatingColor(rating) {
    if (!rating) return 0x808080;
    if (rating >= 4) return 0x00FF00;
    if (rating === 3) return 0xFFA500;
    return 0xFF0000;
}