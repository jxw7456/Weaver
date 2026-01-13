const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const claudeService = require('./claudeService');

const prisma = require('../utils/prisma');

class EscalationScheduler {
    constructor(){
        this.client = null;
        this.isRunning = false;
    }

    /**
     * Initialize the scheduler with the Discord client
     */
    init(client) {
        this.client = client;
        this.startScheduler();
        logger.info('Escalation Scheduler initialized.');
    }

    /**
     * Start the cron job to check for stale tickets
     * Runs every hour
    */
    startScheduler() {
        cron.schedule('0 * * * *', async () => {
            if (this.isRunning) {
                logger.warn('Escalation Scheduler is already running. Skipping...');
                return;
            }
            await this.checkStaleTickets();
        });

        // Initial run after 20 seconds
        setTimeout(() => this.checkStaleTickets(), 20000); 

        logger.info('Escalation Scheduler started. Checking for stale tickets every hour.');
    }

    /**
     * Check for tickets that haven't been claimed in 24+ hours
     */
    async checkStaleTickets() {
        if (!this.client) {
            logger.error('Discord client not initialized for EscalationScheduler.');
            return;
        }

        this.isRunning = true;
        logger.info('Running stale tickets check...');

        try {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Find tickets that are open (not claimed) and created over 24 hours ago
            const staleTickets = await prisma.ticket.findMany({
                where: {
                    status:'open',
                    assignedTo: null,
                    createdAt: { lte: twentyFourHoursAgo },
                    escalatedAt: null
                },
            });

            if (staleTickets.length === 0) {
                logger.info('No stale tickets found.');
                this.isRunning = false;
                return;
            }

            logger.info(`Found ${staleTickets.length} stale ticket(s) to escalate.`);

            for (const ticket of staleTickets) {
                await this.escalateTicket(ticket);
            }
        } catch (error) {
            logger.error('Error checking stale tickets:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Escalate a stale ticket by notifying support staff
     */
    async escalateTicket(ticket) {
        try {
            // Generate escalation message using Claude
            const escalationMessage = await claudeService.generateEscalationMessage(ticket);

            // Get the ticket channel/thread
            const ticketChannel = await this.client.channels.fetch(ticket.channelId).catch(() => null);

            if (!ticketChannel) {
                logger.warn(`Ticket channel not found for ticket ID: ${ticket.id}`);
                return;
            }

            // Calculate how long the ticket has been waiting
            const waitTime = this.formatWaitTime(new Date() - ticket.createdAt);

            // Create escalation embed
            const escalationEmbed = new EmbedBuilder()
                .setTitle('⚠️ Ticket Escalation - Needs Attention')
                .setDescription(escalationMessage)
                .addFields(
                    { name: '🎫 Ticket ID', value: `#${ticket.id}`, inline: true },
                    { name: '📁 Category', value: ticket.category, inline: true },
                    { name: '⏱️ Waiting', value: waitTime, inline: true },
                    { name: '👤 User', value: `<@${ticket.userId}>`, inline: true }
                )
                .setColor(0xFF6B6B)
                .setTimestamp()
                .setFooter({ text: 'This ticket requires staff attention' });

            // Send escalation to the ticket thread, pinging support role
            await ticketChannel.send({
                content: `<@&${process.env.SUPPORT_ROLE_ID}> 🚨 **Escalation Alert**`,
                embeds: [escalationEmbed]
            });

            // Also send to log channel
            const logChannel = this.client.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('📋 Ticket Escalated')
                    .setDescription(`Ticket #${ticket.id} has been waiting over 24 hours without staff response.`)
                    .addFields(
                        { name: 'Subject', value: ticket.subject.substring(0, 1024) },
                        { name: 'Category', value: ticket.category, inline: true },
                        { name: 'Wait Time', value: waitTime, inline: true },
                        { name: 'Thread', value: `<#${ticket.channelId}>`, inline: true }
                    )
                    .setColor(0xFF6B6B)
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }

            // Mark ticket as escalated (to avoid repeat notifications)
            await prisma.ticket.update({
                where: { id: ticket.id },
                data: { escalatedAt: new Date() }
            });

            logger.info(`Escalated ticket ${ticket.id} - waiting ${waitTime}`);

        } catch (error) {
            logger.error(`Error escalating ticket ${ticket.id}:`, error);
        }
    }

    /**
     * Format wait time in a human-readable way
     */
    formatWaitTime(createdAt) {
        const now = new Date();
        const created = new Date(createdAt);
        const diffMs = now - created;
        
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;

        if (days > 0) {
            return `${days}d ${remainingHours}h`;
        }
        return `${hours}h`;
    }

    /**
     * Manually trigger escalation check (for testing/admin use)
     */
    async manualCheck() {
        logger.info('Manual escalation check triggered');
        await this.checkStaleTickets();
    }
}

module.exports = new EscalationScheduler();