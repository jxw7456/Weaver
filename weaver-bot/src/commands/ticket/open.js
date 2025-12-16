const { SlashCommandBuilder, ChannelType, ThreadAutoArchiveDuration, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { PrismaClient } = require('@prisma/client');
const claudeService = require('../../services/claudeService');
const faqSearchService = require('../../services/faqSearchService');
const filter = require('leo-profanity');

const prisma = new PrismaClient();

// Optional: Add custom words
// filter.add(['customword1', 'customword2']);

// Optional: Remove false positives
// filter.remove(['word1', 'word2']);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Open a support ticket')
        .addStringOption(option =>
            option.setName('subject')
                .setDescription('Brief description of your issue')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Type of support needed')
                .setRequired(true)
                .addChoices(
                    { name: 'App Directory', value: 'App Directory' },
                    { name: 'App Name Change', value: 'App Name Change' },
                    { name: 'API and Gateway', value: 'API & Gateway' },
                    { name: 'Developer Community Perks', value: 'Developer Community Perks' },
                    { name: 'Premium Apps', value: 'Premium Apps' },
                    { name: 'Social SDK', value: 'Social SDK' },
                    { name: 'Teams and Ownership', value: 'Teams & Ownership' },
                    { name: 'Verification and Intents', value: 'Verification & Intents' },
                    { name: 'Webhooks', value: 'Webhooks' },
                )
        ),
    
    async execute(interaction) {
        const subject = interaction.options.getString('subject');
        
        // Check for profanity
        if (filter.check(subject)) {
            return interaction.reply({
                content: '⚠️ Your ticket subject contains inappropriate language. Please provide a professional description of your issue so our support team can assist you effectively.',
                ephemeral: true
            });
        }

        try {
            // Get the forum channel
            const forumChannel = interaction.guild.channels.cache.get(process.env.FORUM_CHANNEL_ID);
            
            if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
                return interaction.reply({
                    content: '❌ Forum channel not configured properly!',
                    ephemeral: true
                });
            }
            
            // Check for existing open ticket in database
            const existingTicket = await prisma.ticket.findFirst({
                where: {
                    userId: interaction.user.id,
                    guildId: interaction.guild.id,
                    status: { in: ['open', 'claimed'] }
                }
            });
            
            if (existingTicket) {
                return interaction.reply({
                    content: `❌ You already have an open ticket: <#${existingTicket.channelId}>`,
                    ephemeral: true
                });
            }
            
            // Defer reply since AI response may take a moment
            await interaction.deferReply({ ephemeral: true });
            
            const subject = interaction.options.getString('subject');
            const category = interaction.options.getString('category');
            
            // Create embed for ticket
            const embed = new EmbedBuilder()
                .setTitle('🎫 Support Ticket')
                .setDescription(`**Subject:** ${subject}\n**Category:** ${category}`)
                .addFields(
                    { name: 'User', value: `${interaction.user}`, inline: true },
                    { name: 'Status', value: '🟢 Open', inline: true },
                    { name: 'Category', value: category, inline: true }
                )
                .setColor(0x00AE86)
                .setTimestamp();
            
            // Create buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_claim')
                        .setLabel('Claim Ticket')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('✋'),
                    new ButtonBuilder()
                        .setCustomId('ticket_close')
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );
            
            // Get forum tags if available
            const categoryTag = forumChannel.availableTags.find(tag => 
                tag.name.toLowerCase() === category.toLowerCase()
            );
            const appliedTags = categoryTag ? [categoryTag.id] : [];
            
            // Create forum thread
            const thread = await forumChannel.threads.create({
                name: `[${category.toUpperCase()}] ${subject.substring(0, 50)}`,
                message: {
                    content: `<@&${process.env.SUPPORT_ROLE_ID}> - New support ticket from ${interaction.user}`,
                    embeds: [embed],
                    components: [row]
                },
                autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                reason: `Support ticket: ${subject}`,
                appliedTags: appliedTags
            });
            
            // Save ticket to database
            const ticket = await prisma.ticket.create({
                data: {
                    userId: interaction.user.id,
                    channelId: thread.id,
                    guildId: interaction.guild.id,
                    subject: subject,
                    category: category,
                    status: 'open'
                }
            });
            
            logger.info(`Ticket ${ticket.id} created by ${interaction.user.tag} - Subject: ${subject}`);
            
            // Generate AI response asynchronously (don't block ticket creation)
            this.generateAIResponse(thread, ticket, interaction.user.id, interaction.guild.id)
                .catch(err => logger.error('Error generating AI response:', err));
            
            await interaction.editReply({
                content: `✅ Ticket created: ${thread}\n\n🤖 Weaver is preparing a helpful response...`
            });
            
        } catch (error) {
            logger.error('Error creating ticket:', error);
            
            const errorMessage = '❌ There was an error creating your ticket. Please try again or contact an administrator.';
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else if (!interaction.replied) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    },

    /**
     * Generate and send AI response to the ticket
     */
    async generateAIResponse(thread, ticket, userId, guildId) {
        try {
            // Fetch relevant FAQs based on ticket subject and category
            const relevantFAQs = await faqSearchService.findRelevantFAQs(
                ticket.subject,
                ticket.category,
                3
            );
            
            // Get user's ticket history for context
            const ticketHistory = await faqSearchService.getUserTicketHistory(
                userId,
                guildId,
                ticket.id
            );
            
            logger.info(`Found ${relevantFAQs.length} relevant FAQs and ${ticketHistory.length} previous tickets for context`);
            
            // Generate AI response
            const aiResponse = await claudeService.generateInitialResponse(
                ticket,
                relevantFAQs,
                ticketHistory
            );
            
            // Create AI response embed
            const aiEmbed = new EmbedBuilder()
                .setAuthor({ 
                    name: '🤖 Weaver Assistant',
                    iconURL: thread.client.user.displayAvatarURL()
                })
                .setDescription(aiResponse)
                .setColor(0x7289DA)
                .setFooter({ text: 'A staff member will be with you shortly' })
                .setTimestamp();

            // Add relevant FAQ references if any were found
            if (relevantFAQs.length > 0) {
                const faqLinks = relevantFAQs
                    .map(faq => `• **FAQ #${faq.id}:** ${faq.question.substring(0, 60)}${faq.question.length > 60 ? '...' : ''}`)
                    .join('\n');
                
                aiEmbed.addFields({
                    name: '📚 Related FAQs',
                    value: `Use \`/faq view <id>\` for full details:\n${faqLinks}`
                });
            }
            
            // Send AI response to thread
            await thread.send({ embeds: [aiEmbed] });
            
            // Mark ticket as having received AI response
            await prisma.ticket.update({
                where: { id: ticket.id },
                data: { aiResponded: true }
            });
            
            // Save AI message to database for history
            await prisma.message.create({
                data: {
                    ticketId: ticket.id,
                    authorId: thread.client.user.id,
                    content: aiResponse,
                    isAI: true
                }
            });
            
            logger.info(`AI response sent for ticket ${ticket.id}`);
            
        } catch (error) {
            logger.error(`Failed to generate AI response for ticket ${ticket.id}:`, error);
            
            // Send fallback message if AI fails
            try {
                const fallbackEmbed = new EmbedBuilder()
                    .setAuthor({ name: '🤖 Weaver Assistant' })
                    .setDescription(claudeService.getFallbackResponse(ticket))
                    .setColor(0x7289DA)
                    .setFooter({ text: 'A staff member will be with you shortly' })
                    .setTimestamp();
                
                await thread.send({ embeds: [fallbackEmbed] });
            } catch (fallbackError) {
                logger.error('Failed to send fallback response:', fallbackError);
            }
        }
    }
};