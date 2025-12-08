const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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
            }
        }
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'faq_select') {
                await handleFAQSelect(interaction);
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('ticketFeedback_')) {
                await handleFeedbackSubmission(interaction);
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
    // Check for staff permission
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

        // Update ticket status to pending feedback
        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { status: 'pending_feedback' }
        });

        // Send message in thread about closure
        const closureEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket Closing')
            .setDescription(`This ticket is being closed by ${interaction.user}.\nAwaiting feedback from the ticket creator.`)
            .setColor(0xFFA500)
            .setTimestamp();

        await interaction.reply({ embeds: [closureEmbed] });

        // Try to DM the original ticket creator
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

            // Also post in the thread for visibility
            await interaction.channel.send({
                content: `📨 A feedback request has been sent to <@${ticket.userId}> via DM.`
            });

        } catch (dmError) {
            logger.error('Could not DM ticket creator:', dmError);
            
            // If DM fails, post feedback request in the thread
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

        // Schedule auto-close after 24 hours if no feedback
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
        }, 24 * 60 * 60 * 1000); // 24 hours

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

// Handle feedback button click (opens modal for ticket creator only)
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

        // Only allow the ticket creator to submit feedback
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
    // Check for staff permission
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

// Handle feedback modal submission
async function handleFeedbackSubmission(interaction) {
    // IMPORTANT: Defer reply immediately to prevent timeout
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

        logger.info(`Found ticket: ${ticket.id} - ${ticket.subject}`);

        // Check if feedback already exists
        const existingFeedback = await prisma.feedback.findUnique({
            where: { ticketId: ticket.id }
        });

        if (existingFeedback) {
            return interaction.editReply({
                content: '❌ Feedback has already been submitted for this ticket.'
            });
        }

        // Save feedback
        await prisma.feedback.create({
            data: {
                ticketId: ticket.id,
                rating: rating,
                comment: comments
            }
        });

        logger.info(`Feedback saved for ticket ${ticket.id}`);

        // Update ticket status
        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { 
                status: 'closed',
                closedAt: new Date()
            }
        });

        // Reply to user first (most important)
        await interaction.editReply({
            content: '✅ Thank you for your feedback! The ticket will now be archived.'
        });

        // Now handle the less critical stuff (log channel, archiving) separately
        // so errors here don't affect the user experience
        
        try {
            // Create feedback embed for log channel
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
                    { name: '💬 Comments', value: comments.substring(0, 1024) }
                )
                .setColor(getRatingColor(rating))
                .setTimestamp()
                .setFooter({ text: `Feedback by ${interaction.user.tag}` });

            // Send to log channel
            const logChannel = interaction.client.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send({ embeds: [feedbackEmbed] });
                logger.info(`Feedback logged to channel for ticket ${ticket.id}`);
            } else {
                logger.warn('Log channel not found in cache');
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
        logger.error('Error stack:', error.stack);
        
        try {
            await interaction.editReply({
                content: '❌ There was an error processing your feedback. Please try again.'
            });
        } catch (replyError) {
            logger.error('Could not send error reply:', replyError);
        }
    }
}

// Close ticket without feedback (auto-close after timeout)
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

        // Log the closure
        const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Closed (No Feedback)')
                .addFields(
                    { name: '🎫 Ticket ID', value: `#${ticket.id}`, inline: true },
                    { name: '👤 User', value: `<@${ticket.userId}>`, inline: true },
                    { name: '📁 Category', value: ticket.category, inline: true }
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

// FAQ Feedback handler
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

// FAQ select menu handler
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
function getStarRating(rating) {
    const stars = '⭐'.repeat(rating);
    const emptyStars = '☆'.repeat(5 - rating);
    return `${stars}${emptyStars} (${rating}/5)`;
}

function getRatingColor(rating) {
    if (rating >= 4) return 0x00FF00;
    if (rating === 3) return 0xFFA500;
    return 0xFF0000;
}

function formatDuration(start, end) {
    const diff = end - start;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}