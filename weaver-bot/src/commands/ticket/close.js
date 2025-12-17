const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const logger = require('../../utils/logger');

const prisma = new PrismaClient();

// Command to close a ticket with optional reason and feedback modal
module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket with optional reason')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for closing the ticket')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
    
    async execute(interaction) {
        // Check if in a ticket thread
        if (!interaction.channel.isThread()) {
            return interaction.reply({
                content: '❌ This command can only be used in ticket threads.',
                ephemeral: true
            });
        }

        const ticket = await prisma.ticket.findFirst({
            where: { channelId: interaction.channel.id }
        });

        if (!ticket) {
            return interaction.reply({
                content: '❌ This is not a valid ticket thread.',
                ephemeral: true
            });
        }

        if (ticket.status === 'closed' || ticket.status === 'pending_feedback') {
            return interaction.reply({
                content: '❌ This ticket is already closed or pending feedback.',
                ephemeral: true
            });
        }

        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            // Update ticket status to pending feedback
            await prisma.ticket.update({
                where: { id: ticket.id },
                data: { status: 'pending_feedback' }
            });

            // Send closure message in thread
            const closureEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Closing')
                .setDescription(`This ticket is being closed by ${interaction.user}.`)
                .addFields({ name: '📝 Reason', value: reason })
                .setColor(0xFFA500)
                .setTimestamp();

            await interaction.reply({ embeds: [closureEmbed] });

            // Try to DM the original ticket creator for feedback
            try {
                const ticketCreator = await interaction.client.users.fetch(ticket.userId);
                
                const feedbackEmbed = new EmbedBuilder()
                    .setTitle('📝 Ticket Feedback Request')
                    .setDescription(`Your support ticket **"${ticket.subject}"** has been resolved.\n\nPlease rate your experience by clicking the button below.`)
                    .addFields(
                        { name: '📂 Category', value: ticket.category, inline: true },
                        { name: '🎫 Ticket ID', value: `#${ticket.id}`, inline: true },
                        { name: '⭐ Rating Scale', value: '1 = Very Poor\n2 = Poor\n3 = Okay\n4 = Good\n5 = Excellent', inline: false }
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
                
                // If DM fails, post feedback request in the thread
                const feedbackEmbed = new EmbedBuilder()
                    .setTitle('📝 Feedback Request')
                    .setDescription(`<@${ticket.userId}>, please provide your feedback for this ticket.`)
                    .addFields({ name: '📝 Close Reason', value: reason })
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
                        await closeTicketWithoutFeedback(interaction.client, ticket);
                    }
                } catch (err) {
                    logger.error('Error in auto-close timeout:', err);
                }
            }, 24 * 60 * 60 * 1000); // 24 hours

            logger.info(`Ticket ${ticket.id} close initiated by ${interaction.user.tag} - Reason: ${reason}`);

        } catch (error) {
            logger.error('Error closing ticket:', error);
            if (!interaction.replied) {
                await interaction.reply({
                    content: '❌ There was an error closing this ticket.',
                    ephemeral: true
                });
            }
        }
    }
};

// Close ticket without feedback (auto-close after timeout)
async function closeTicketWithoutFeedback(client, ticket) {
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