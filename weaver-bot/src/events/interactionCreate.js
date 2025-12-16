const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;
            
            try {
                await command.execute(interaction);
            } catch (error) {
                logger.error(`Command error: ${interaction.commandName}`, error);
                const errorMessage = 'There was an error executing this command!';
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            }
        }
        else if (interaction.isButton()) {
            const { customId } = interaction;
            
            if (customId === 'ticket_close') {
                await handleTicketClose(interaction);
            } else if (customId === 'ticket_claim') {
                await handleTicketClaim(interaction);
            } else if (customId.startsWith('faq_helpful_') || customId.startsWith('faq_not_helpful_')) {
                await handleFAQFeedback(interaction);
            } else if (customId.startsWith('feedback_submit_')) {
                await handleFeedbackButtonClick(interaction);
            } else if (customId.startsWith('track_ticket_')) {
                await handleTrackTicket(interaction);
            } else if (customId.startsWith('view_tracked_')) {
                await handleViewTrackedTickets(interaction);
            }
        }
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'faq_select') {
                await handleFAQSelect(interaction);
            } else if (interaction.customId.startsWith('rating_filter_')) {
                await handleRatingFilter(interaction);
            } else if (interaction.customId.startsWith('timerange_filter_')) {
                await handleTimeRangeFilter(interaction);
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('ticketFeedback_')) {
                await handleFeedbackSubmission(interaction);
            } else if (interaction.customId.startsWith('trackNotes_')) {
                await handleTrackNotesSubmission(interaction);
            }
        }
    }
};

// Check if user has admin/support role
async function hasStaffPermission(interaction) {
    const member = interaction.member;
    const supportRoleId = process.env.SUPPORT_ROLE_ID;
    const adminRoleId = process.env.ADMIN_ROLE_ID;
    
    return member.roles.cache.has(supportRoleId) || 
           member.roles.cache.has(adminRoleId) ||
           member.permissions.has('Administrator');
}

// Handle ticket close button
async function handleTicketClose(interaction) {
    if (!await hasStaffPermission(interaction)) {
        return interaction.reply({
            content: '❌ Only support staff can close tickets.',
            ephemeral: true
        });
    }

    try {
        const ticket = await prisma.ticket.findFirst({
            where: { channelId: interaction.channel.id }
        });

        if (!ticket) {
            return interaction.reply({
                content: '❌ Could not find ticket information.',
                ephemeral: true
            });
        }

        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { status: 'pending_feedback' }
        });

        const closureEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket Closing')
            .setDescription(`This ticket is being closed by ${interaction.user}.\nAwaiting feedback from the ticket creator.`)
            .setColor(0xFFA500)
            .setTimestamp();

        await interaction.reply({ embeds: [closureEmbed] });

        try {
            const ticketCreator = await interaction.client.users.fetch(ticket.userId);
            
            const feedbackEmbed = new EmbedBuilder()
                .setTitle('📝 Ticket Feedback Request')
                .setDescription(`Your support ticket **"${ticket.subject}"** has been resolved.\n\nPlease provide your feedback by clicking the button below.`)
                .addFields(
                    { name: '📁 Category', value: ticket.category, inline: true },
                    { name: '🎫 Ticket ID', value: `#${ticket.id}`, inline: true }
                )
                .setColor(0x00AE86)
                .setTimestamp();

            const feedbackRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`feedback_submit_${ticket.id}`)
                        .setLabel('Provide Feedback')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📝')
                );

            await ticketCreator.send({
                embeds: [feedbackEmbed],
                components: [feedbackRow]
            });

            await interaction.channel.send({
                content: `📨 A feedback request has been sent to <@${ticket.userId}> via DM.`
            });

        } catch (dmError) {
            logger.error('Could not DM ticket creator:', dmError);
            
            const feedbackEmbed = new EmbedBuilder()
                .setTitle('📝 Feedback Request')
                .setDescription(`<@${ticket.userId}>, please provide your feedback for this ticket.`)
                .setColor(0x00AE86);

            const feedbackRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`feedback_submit_${ticket.id}`)
                        .setLabel('Provide Feedback')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📝')
                );

            await interaction.channel.send({
                content: `<@${ticket.userId}>`,
                embeds: [feedbackEmbed],
                components: [feedbackRow]
            });
        }

        setTimeout(async () => {
            try {
                const currentTicket = await prisma.ticket.findUnique({
                    where: { id: ticket.id }
                });
                
                if (currentTicket && currentTicket.status === 'pending_feedback') {
                    await closeTicketWithoutFeedback(interaction.client, ticket, interaction.user.id);
                }
            } catch (err) {
                logger.error('Error in auto-close timeout:', err);
            }
        }, 24 * 60 * 60 * 1000);

        logger.info(`Ticket ${ticket.id} close initiated by ${interaction.user.tag}`);

    } catch (error) {
        logger.error('Error handling ticket close:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: '❌ There was an error closing this ticket.',
                ephemeral: true
            });
        }
    }
}

// Handle feedback button click
async function handleFeedbackButtonClick(interaction) {
    const ticketId = parseInt(interaction.customId.split('_')[2]);
    
    try {
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId }
        });

        if (!ticket) {
            return interaction.reply({
                content: '❌ Ticket not found.',
                ephemeral: true
            });
        }

        if (interaction.user.id !== ticket.userId) {
            return interaction.reply({
                content: '❌ Only the ticket creator can provide feedback.',
                ephemeral: true
            });
        }

        if (ticket.status === 'closed') {
            return interaction.reply({
                content: '❌ This ticket has already been closed.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`ticketFeedback_${ticketId}`)
            .setTitle('Ticket Feedback');
        
        const ratingInput = new TextInputBuilder()
            .setCustomId('rating')
            .setLabel('Rate your experience (1-5)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter a number from 1 to 5')
            .setMinLength(1)
            .setMaxLength(1)
            .setRequired(true);
        
        const commentsInput = new TextInputBuilder()
            .setCustomId('comments')
            .setLabel('Additional feedback (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Tell us about your experience...')
            .setMaxLength(1000)
            .setRequired(false);
        
        modal.addComponents(
            new ActionRowBuilder().addComponents(ratingInput),
            new ActionRowBuilder().addComponents(commentsInput)
        );
        
        await interaction.showModal(modal);

    } catch (error) {
        logger.error('Error handling feedback button:', error);
        await interaction.reply({
            content: '❌ Error processing feedback request.',
            ephemeral: true
        });
    }
}

// Handle ticket claim button
async function handleTicketClaim(interaction) {
    if (!await hasStaffPermission(interaction)) {
        return interaction.reply({
            content: '❌ Only support staff can claim tickets.',
            ephemeral: true
        });
    }

    try {
        const ticket = await prisma.ticket.findFirst({
            where: { channelId: interaction.channel.id }
        });

        if (!ticket) {
            return interaction.reply({
                content: '❌ Could not find ticket information.',
                ephemeral: true
            });
        }

        if (ticket.assignedTo) {
            return interaction.reply({
                content: `❌ This ticket is already claimed by <@${ticket.assignedTo}>.`,
                ephemeral: true
            });
        }

        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { 
                assignedTo: interaction.user.id,
                status: 'claimed'
            }
        });

        const claimEmbed = new EmbedBuilder()
            .setTitle('🎫 Ticket Claimed')
            .setDescription(`This ticket has been claimed by ${interaction.user}`)
            .setColor(0xFFA500)
            .setTimestamp();

        await interaction.reply({ embeds: [claimEmbed] });
        logger.info(`Ticket ${ticket.id} claimed by ${interaction.user.tag}`);

    } catch (error) {
        logger.error('Error claiming ticket:', error);
        await interaction.reply({
            content: '❌ Failed to claim ticket. Please try again.',
            ephemeral: true
        });
    }
}

// Handle feedback modal submission - UPDATED with new components
async function handleFeedbackSubmission(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const ticketId = parseInt(interaction.customId.split('_')[1]);
        logger.info(`Processing feedback for ticket ID: ${ticketId}`);
        
        const rating = parseInt(interaction.fields.getTextInputValue('rating'));
        const comments = interaction.fields.getTextInputValue('comments') || 'No additional comments';
        
        if (rating < 1 || rating > 5 || isNaN(rating)) {
            return interaction.editReply({
                content: '❌ Please enter a valid rating between 1 and 5.'
            });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId }
        });

        if (!ticket) {
            logger.error(`Ticket not found: ${ticketId}`);
            return interaction.editReply({
                content: '❌ Could not find ticket information.'
            });
        }

        const existingFeedback = await prisma.feedback.findUnique({
            where: { ticketId: ticket.id }
        });

        if (existingFeedback) {
            return interaction.editReply({
                content: '❌ Feedback has already been submitted for this ticket.'
            });
        }

        await prisma.feedback.create({
            data: {
                ticketId: ticket.id,
                rating: rating,
                comment: comments
            }
        });

        logger.info(`Feedback saved for ticket ${ticket.id}`);

        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { 
                status: 'closed',
                closedAt: new Date()
            }
        });

        await interaction.editReply({
            content: '✅ Thank you for your feedback! The ticket will now be archived.'
        });

        // Send enhanced feedback embed to log channel
        try {
            const feedbackEmbed = new EmbedBuilder()
                .setTitle('📊 Ticket Feedback Received')
                .setDescription(`Feedback for ticket: **${ticket.subject}**`)
                .addFields(
                    { name: '🎫 Ticket ID', value: `#${ticket.id}`, inline: true },
                    { name: '👤 User', value: `<@${ticket.userId}>`, inline: true },
                    { name: '⭐ Rating', value: getStarRating(rating), inline: true },
                    { name: '📁 Category', value: ticket.category, inline: true },
                    { name: '👨‍💼 Assigned To', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'Unassigned', inline: true },
                    { name: '⏱️ Duration', value: formatDuration(ticket.createdAt, new Date()), inline: true },
                    { name: '💬 Comments', value: comments.substring(0, 1024) },
                    { name: '🔗 Ticket Thread', value: `<#${ticket.channelId}>` }
                )
                .setColor(getRatingColor(rating))
                .setTimestamp()
                .setFooter({ text: `Feedback by ${interaction.user.tag}` });

            // Create rating filter dropdown
            const ratingFilterRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`rating_filter_${ticket.id}`)
                        .setPlaceholder('🔍 View tickets by rating...')
                        .addOptions([
                            { label: '⭐ 1 Star Tickets', value: '1', description: 'View all 1-star rated tickets' },
                            { label: '⭐⭐ 2 Star Tickets', value: '2', description: 'View all 2-star rated tickets' },
                            { label: '⭐⭐⭐ 3 Star Tickets', value: '3', description: 'View all 3-star rated tickets' },
                            { label: '⭐⭐⭐⭐ 4 Star Tickets', value: '4', description: 'View all 4-star rated tickets' },
                            { label: '⭐⭐⭐⭐⭐ 5 Star Tickets', value: '5', description: 'View all 5-star rated tickets' },
                            { label: `Similar to this (${rating}⭐)`, value: `similar_${rating}`, description: `View tickets with ${rating}-star rating`, emoji: '🎯' }
                        ])
                );

            // Create action buttons row
            const actionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`track_ticket_${ticket.id}`)
                        .setLabel('Track for Review')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📋'),
                    new ButtonBuilder()
                        .setCustomId(`view_tracked_${rating}`)
                        .setLabel('View Tracked Tickets')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📑'),
                    new ButtonBuilder()
                        .setURL(`https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`)
                        .setLabel('Go to Thread')
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('🔗')
                );

            const logChannel = interaction.client.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send({ 
                    embeds: [feedbackEmbed],
                    components: [ratingFilterRow, actionRow]
                });
                logger.info(`Enhanced feedback logged for ticket ${ticket.id}`);
            }
        } catch (logError) {
            logger.error('Error sending to log channel:', logError);
        }

        // Archive the ticket thread
        try {
            const ticketChannel = await interaction.client.channels.fetch(ticket.channelId);
            if (ticketChannel && ticketChannel.isThread()) {
                await ticketChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('✅ Ticket Closed')
                            .setDescription('Feedback has been received. This ticket is now closed.')
                            .setColor(0x00FF00)
                            .setTimestamp()
                    ]
                });
                
                setTimeout(async () => {
                    try {
                        await ticketChannel.edit({
                            archived: true,
                            locked: true,
                            reason: 'Ticket closed with feedback.'
                        });
                        logger.info(`Ticket ${ticket.id} archived and locked`);
                    } catch (err) {
                        logger.error('Error archiving ticket:', err);
                    }
                }, 3000);
            }
        } catch (channelError) {
            logger.error('Error fetching/updating ticket channel:', channelError);
        }

    } catch (error) {
        logger.error('Error handling feedback submission:', error);
        try {
            await interaction.editReply({
                content: '❌ There was an error processing your feedback. Please try again.'
            });
        } catch (replyError) {
            logger.error('Could not send error reply:', replyError);
        }
    }
}

// Handle rating filter dropdown
async function handleRatingFilter(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        let selectedRating;
        const value = interaction.values[0];
        
        if (value.startsWith('similar_')) {
            selectedRating = parseInt(value.split('_')[1]);
        } else {
            selectedRating = parseInt(value);
        }

        // Show time range selection
        const timeRangeEmbed = new EmbedBuilder()
            .setTitle(`📊 Viewing ${selectedRating}-Star Tickets`)
            .setDescription('Select a time range to filter tickets:')
            .setColor(getRatingColor(selectedRating));

        const timeRangeRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`timerange_filter_${selectedRating}`)
                    .setPlaceholder('Select time range...')
                    .addOptions([
                        { label: 'Last 7 Days', value: '7', emoji: '📅' },
                        { label: 'Last 30 Days', value: '30', emoji: '📆' },
                        { label: 'Last 90 Days', value: '90', emoji: '🗓️' },
                        { label: 'All Time', value: 'all', emoji: '♾️' }
                    ])
            );

        await interaction.editReply({
            embeds: [timeRangeEmbed],
            components: [timeRangeRow]
        });

    } catch (error) {
        logger.error('Error handling rating filter:', error);
        await interaction.editReply({
            content: '❌ Error filtering tickets. Please try again.'
        });
    }
}

// Handle time range filter and display results
async function handleTimeRangeFilter(interaction) {
    await interaction.deferUpdate();
    
    try {
        const rating = parseInt(interaction.customId.split('_')[2]);
        const timeRange = interaction.values[0];
        
        let dateFilter = {};
        if (timeRange !== 'all') {
            const days = parseInt(timeRange);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            dateFilter = { gte: startDate };
        }

        // Fetch tickets with the selected rating
        const feedbacks = await prisma.feedback.findMany({
            where: {
                rating: rating,
                createdAt: timeRange !== 'all' ? dateFilter : undefined
            },
            include: {
                ticket: true
            },
            orderBy: { createdAt: 'desc' },
            take: 25
        });

        if (feedbacks.length === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`📊 ${rating}-Star Tickets`)
                        .setDescription(`No tickets found with ${rating}-star rating in the selected time range.`)
                        .setColor(getRatingColor(rating))
                ],
                components: []
            });
        }

        // Build results embed
        const timeLabel = timeRange === 'all' ? 'All Time' : `Last ${timeRange} Days`;
        const resultsEmbed = new EmbedBuilder()
            .setTitle(`📊 ${rating}-Star Tickets (${timeLabel})`)
            .setDescription(`Found **${feedbacks.length}** ticket(s) with ${getStarRating(rating)}`)
            .setColor(getRatingColor(rating))
            .setTimestamp();

        // Add ticket summaries (max 10 to avoid embed limits)
        const ticketList = feedbacks.slice(0, 10).map((fb, i) => {
            const t = fb.ticket;
            const duration = t.closedAt ? formatDuration(t.createdAt, t.closedAt) : 'N/A';
            return `**${i + 1}.** [#${t.id}](https://discord.com/channels/${t.guildId}/${t.channelId}) - ${t.subject.substring(0, 40)}${t.subject.length > 40 ? '...' : ''}\n` +
                   `└ 📁 ${t.category} | ⏱️ ${duration} | 👨‍💼 ${t.assignedTo ? `<@${t.assignedTo}>` : 'Unassigned'}`;
        }).join('\n\n');

        resultsEmbed.addFields({ name: 'Tickets', value: ticketList || 'No tickets found' });

        if (feedbacks.length > 10) {
            resultsEmbed.setFooter({ text: `Showing 10 of ${feedbacks.length} tickets` });
        }

        // Stats summary
        const avgDuration = feedbacks.reduce((sum, fb) => {
            if (fb.ticket.closedAt) {
                return sum + (new Date(fb.ticket.closedAt) - new Date(fb.ticket.createdAt));
            }
            return sum;
        }, 0) / feedbacks.filter(fb => fb.ticket.closedAt).length;

        const categories = {};
        feedbacks.forEach(fb => {
            categories[fb.ticket.category] = (categories[fb.ticket.category] || 0) + 1;
        });
        const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

        resultsEmbed.addFields(
            { name: '📈 Stats', value: 
                `**Avg Resolution Time:** ${formatDuration(0, avgDuration)}\n` +
                `**Top Category:** ${topCategory ? `${topCategory[0]} (${topCategory[1]})` : 'N/A'}`,
                inline: true
            }
        );

        await interaction.editReply({
            embeds: [resultsEmbed],
            components: []
        });

    } catch (error) {
        logger.error('Error handling time range filter:', error);
        await interaction.editReply({
            content: '❌ Error fetching tickets. Please try again.',
            embeds: [],
            components: []
        });
    }
}

// Handle track ticket button
async function handleTrackTicket(interaction) {
    if (!await hasStaffPermission(interaction)) {
        return interaction.reply({
            content: '❌ Only support staff can track tickets for review.',
            ephemeral: true
        });
    }

    const ticketId = parseInt(interaction.customId.split('_')[2]);

    try {
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { feedback: true }
        });

        if (!ticket) {
            return interaction.reply({
                content: '❌ Ticket not found.',
                ephemeral: true
            });
        }

        // Check if already tracked
        const existingTracked = await prisma.trackedTicket.findUnique({
            where: { ticketId: ticketId }
        });

        if (existingTracked) {
            return interaction.reply({
                content: `⚠️ This ticket is already being tracked (Status: ${existingTracked.status}).\nTracked by: <@${existingTracked.trackedBy}>`,
                ephemeral: true
            });
        }

        // Show modal for tracking notes
        const modal = new ModalBuilder()
            .setCustomId(`trackNotes_${ticketId}`)
            .setTitle('Track Ticket for Review');

        const priorityInput = new TextInputBuilder()
            .setCustomId('priority')
            .setLabel('Priority (low/normal/high/urgent)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('normal')
            .setRequired(false);

        const notesInput = new TextInputBuilder()
            .setCustomId('notes')
            .setLabel('Review Notes (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Why should this ticket be reviewed? Any specific concerns?')
            .setMaxLength(500)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(priorityInput),
            new ActionRowBuilder().addComponents(notesInput)
        );

        await interaction.showModal(modal);

    } catch (error) {
        logger.error('Error handling track ticket:', error);
        await interaction.reply({
            content: '❌ Error tracking ticket. Please try again.',
            ephemeral: true
        });
    }
}

// Handle track notes modal submission
async function handleTrackNotesSubmission(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const ticketId = parseInt(interaction.customId.split('_')[1]);
        const priorityInput = interaction.fields.getTextInputValue('priority')?.toLowerCase() || 'normal';
        const notes = interaction.fields.getTextInputValue('notes') || null;

        // Validate priority
        const validPriorities = ['low', 'normal', 'high', 'urgent'];
        const priority = validPriorities.includes(priorityInput) ? priorityInput : 'normal';

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { feedback: true }
        });

        if (!ticket) {
            return interaction.editReply({ content: '❌ Ticket not found.' });
        }

        // Create tracked ticket entry
        await prisma.trackedTicket.create({
            data: {
                ticketId: ticketId,
                rating: ticket.feedback?.rating || 0,
                priority: priority,
                notes: notes,
                trackedBy: interaction.user.id
            }
        });

        // Update ticket record
        await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                tracked: true,
                trackedAt: new Date(),
                trackedBy: interaction.user.id,
                trackingNotes: notes
            }
        });

        const priorityEmoji = {
            low: '🟢',
            normal: '🟡',
            high: '🟠',
            urgent: '🔴'
        };

        const confirmEmbed = new EmbedBuilder()
            .setTitle('📋 Ticket Tracked for Review')
            .setDescription(`Ticket #${ticketId} has been added to the review tracker.`)
            .addFields(
                { name: 'Priority', value: `${priorityEmoji[priority]} ${priority.charAt(0).toUpperCase() + priority.slice(1)}`, inline: true },
                { name: 'Rating', value: ticket.feedback ? getStarRating(ticket.feedback.rating) : 'No feedback', inline: true },
                { name: 'Notes', value: notes || 'No notes provided' }
            )
            .setColor(0x00AE86)
            .setTimestamp()
            .setFooter({ text: 'Use /tracked-tickets to view all tracked tickets' });

        await interaction.editReply({ embeds: [confirmEmbed] });

        logger.info(`Ticket ${ticketId} tracked by ${interaction.user.tag} with priority: ${priority}`);

    } catch (error) {
        logger.error('Error handling track notes submission:', error);
        await interaction.editReply({
            content: '❌ Error saving tracking information. Please try again.'
        });
    }
}

// Handle view tracked tickets button
async function handleViewTrackedTickets(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const trackedTickets = await prisma.trackedTicket.findMany({
            where: { status: { in: ['pending', 'in_review'] } },
            orderBy: [
                { priority: 'desc' },
                { rating: 'asc' },
                { createdAt: 'asc' }
            ],
            take: 15
        });

        if (trackedTickets.length === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📑 Tracked Tickets')
                        .setDescription('No tickets are currently being tracked for review.')
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

        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        const priorityEmoji = { urgent: '🔴', high: '🟠', normal: '🟡', low: '🟢' };

        const sortedTracked = trackedTickets.sort((a, b) => {
            if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            }
            return a.rating - b.rating;
        });

        const ticketList = sortedTracked.map((tracked, i) => {
            const t = ticketMap.get(tracked.ticketId);
            if (!t) return null;
            return `${priorityEmoji[tracked.priority]} **#${t.id}** - ${t.subject.substring(0, 35)}${t.subject.length > 35 ? '...' : ''}\n` +
                   `└ ${getStarRating(tracked.rating)} | 📁 ${t.category} | [View](https://discord.com/channels/${t.guildId}/${t.channelId})`;
        }).filter(Boolean).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle('📑 Tracked Tickets for Review')
            .setDescription(`**${trackedTickets.length}** ticket(s) pending review\n\n${ticketList}`)
            .addFields(
                { name: '🔴 Urgent', value: trackedTickets.filter(t => t.priority === 'urgent').length.toString(), inline: true },
                { name: '🟠 High', value: trackedTickets.filter(t => t.priority === 'high').length.toString(), inline: true },
                { name: '🟡 Normal', value: trackedTickets.filter(t => t.priority === 'normal').length.toString(), inline: true }
            )
            .setColor(0x00AE86)
            .setTimestamp()
            .setFooter({ text: 'Use /tracked-tickets for full management' });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        logger.error('Error viewing tracked tickets:', error);
        await interaction.editReply({
            content: '❌ Error fetching tracked tickets. Please try again.'
        });
    }
}

// Close ticket without feedback
async function closeTicketWithoutFeedback(client, ticket, closedBy) {
    try {
        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { 
                status: 'closed',
                closedAt: new Date()
            }
        });

        const ticketChannel = await client.channels.fetch(ticket.channelId);
        if (ticketChannel && ticketChannel.isThread()) {
            await ticketChannel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🔒 Ticket Auto-Closed')
                        .setDescription('This ticket was automatically closed after 24 hours without feedback.')
                        .setColor(0xFF9800)
                        .setTimestamp()
                ]
            });
            
            await ticketChannel.edit({
                archived: true,
                locked: true,
                reason: 'Ticket auto-closed without feedback.'
            });
        }

        const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Closed (No Feedback)')
                .addFields(
                    { name: '🎫 Ticket ID', value: `#${ticket.id}`, inline: true },
                    { name: '👤 User', value: `<@${ticket.userId}>`, inline: true },
                    { name: '📁 Category', value: ticket.category, inline: true },
                    { name: '🔗 Thread', value: `<#${ticket.channelId}>` }
                )
                .setColor(0xFF9800)
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }

        logger.info(`Ticket ${ticket.id} auto-closed without feedback`);

    } catch (error) {
        logger.error('Error auto-closing ticket:', error);
    }
}

// FAQ handlers (unchanged)
async function handleFAQFeedback(interaction) {
    const parts = interaction.customId.split('_');
    const faqId = parseInt(parts[parts.length - 1]);
    const isHelpful = interaction.customId.includes('helpful') && !interaction.customId.includes('not_helpful');

    try {
        const field = isHelpful ? 'helpful' : 'notHelpful';
        
        await prisma.fAQ.update({
            where: { id: faqId },
            data: { [field]: { increment: 1 } }
        });

        await interaction.reply({
            content: '✅ Thank you for your feedback!',
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error updating FAQ feedback:', error);
        await interaction.reply({
            content: '❌ Failed to record feedback.',
            ephemeral: true
        });
    }
}

// Display FAQ details
async function handleFAQSelect(interaction) {
    const faqId = parseInt(interaction.values[0]);
    
    try {
        const faq = await prisma.fAQ.findUnique({ where: { id: faqId } });

        if (!faq) {
            return interaction.reply({ content: '❌ FAQ not found.', ephemeral: true });
        }

        await prisma.fAQ.update({
            where: { id: faqId },
            data: { views: { increment: 1 } }
        });

        const embed = new EmbedBuilder()
            .setTitle(`❓ ${faq.question}`)
            .setDescription(faq.answer)
            .addFields(
                { name: '📂 Category', value: faq.category, inline: true },
                { name: '👀 Views', value: faq.views.toString(), inline: true }
            )
            .setColor(0x00AE86)
            .setFooter({ text: `FAQ ID: ${faq.id}` });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`faq_helpful_${faqId}`)
                    .setLabel('Helpful')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👍'),
                new ButtonBuilder()
                    .setCustomId(`faq_not_helpful_${faqId}`)
                    .setLabel('Not Helpful')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('👎')
            );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    } catch (error) {
        logger.error('Error displaying FAQ:', error);
        await interaction.reply({ content: '❌ Error displaying FAQ.', ephemeral: true });
    }
}

// Helper functions
// Generate star rating string
function getStarRating(rating) {
    const stars = '⭐'.repeat(rating);
    const empty = '☆'.repeat(5 - rating);
    return `${stars}${empty} (${rating}/5)`;
}

// Get color based on rating
function getRatingColor(rating) {
    if (rating >= 4) return 0x00FF00;
    if (rating === 3) return 0xFFA500;
    return 0xFF0000;
}

// Format duration between two dates
function formatDuration(start, end) {
    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);
    const diff = endDate - startDate;
    
    if (isNaN(diff)) return 'N/A';
    
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h`;
    }
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}