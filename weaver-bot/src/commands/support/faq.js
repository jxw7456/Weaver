const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const logger = require('../../utils/logger');

const prisma = new PrismaClient();

// FAQ Command
module.exports = {
    data: new SlashCommandBuilder()
        .setName('faq')
        .setDescription('Search and view frequently asked questions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('search')
                .setDescription('Search for an FAQ')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Search term or question')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List FAQs by category')
                .addStringOption(option =>
                    option.setName('category')
                        .setDescription('Category to filter by')
                        .setRequired(false)
                        .addChoices(
                            { name: 'App Directory', value: 'App Directory' },
                            { name: 'App Name Change', value: 'App Name Change' },
                            { name: 'API & Gateway', value: 'API & Gateway' },
                            { name: 'Developer Community Perks', value: 'Developer Community Perks' },
                            { name: 'Premium Apps', value: 'Premium Apps' },
                            { name: 'Social SDK', value: 'Social SDK' },
                            { name: 'Teams and Ownership', value: 'Team and Ownership' },
                            { name: 'Verification & Intents', value: 'Verification & Intents' },
                            { name: 'Webhooks', value: 'Webhooks' },
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View a specific FAQ by ID')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('FAQ ID number')
                        .setRequired(true)
                )
        ),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'search') {
            await handleSearch(interaction);
        } else if (subcommand === 'list') {
            await handleList(interaction);
        } else if (subcommand === 'view') {
            await handleView(interaction);
        }
    }
};

// Handlers for subcommands
async function handleSearch(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const query = interaction.options.getString('query').toLowerCase();
    
    try {
        // Search in questions, answers, and keywords
        const faqs = await prisma.fAQ.findMany({
            where: {
                OR: [
                    { question: { contains: query, mode: 'insensitive' } },
                    { answer: { contains: query, mode: 'insensitive' } },
                    { keywords: { hasSome: [query] } }
                ]
            },
            take: 10,
            orderBy: { views: 'desc' }
        });

        if (faqs.length === 0) {
            return interaction.editReply({
                content: `❌ No FAQs found matching "${query}". Try different keywords or use \`/faq list\` to browse by category.`
            });
        }

        // Create select menu with results
        const options = faqs.slice(0, 25).map(faq => ({
            label: faq.question.substring(0, 100),
            description: `Category: ${faq.category} | ID: ${faq.id}`,
            value: faq.id.toString()
        }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('faq_select')
            .setPlaceholder('Choose an FAQ to view')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('🔍 FAQ Search Results')
            .setDescription(`Found ${faqs.length} FAQ(s) matching "${query}".\nSelect one below to view the full answer.`)
            .setColor(0x00AE86);

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

        logger.info(`FAQ search: "${query}" by ${interaction.user.tag}`);
    } catch (error) {
        logger.error('Error searching FAQs:', error);
        await interaction.editReply({
            content: '❌ Error searching FAQs. Please try again.'
        });
    }
}

// List FAQs handler
async function handleList(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const category = interaction.options.getString('category');
    
    try {
        const where = category ? { category } : {};
        
        const faqs = await prisma.fAQ.findMany({
            where,
            orderBy: { views: 'desc' },
            take: 25
        });

        if (faqs.length === 0) {
            return interaction.editReply({
                content: `❌ No FAQs found${category ? ` in category "${category}"` : ''}.`
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`📚 FAQ List${category ? ` - ${category}` : ''}`)
            .setDescription(`Found ${faqs.length} FAQ(s). Use \`/faq view <id>\` to view a specific FAQ.`)
            .setColor(0x00AE86);

        // Group by category
        const grouped = faqs.reduce((acc, faq) => {
            if (!acc[faq.category]) acc[faq.category] = [];
            acc[faq.category].push(faq);
            return acc;
        }, {});

        for (const [cat, items] of Object.entries(grouped)) {
            const value = items
                .map(faq => `**#${faq.id}** - ${faq.question.substring(0, 80)}${faq.question.length > 80 ? '...' : ''}`)
                .join('\n')
                .substring(0, 1024);
            
            embed.addFields({ name: cat, value });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        logger.error('Error listing FAQs:', error);
        await interaction.editReply({
            content: '❌ Error fetching FAQs. Please try again.'
        });
    }
}

// View FAQ handler
async function handleView(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const faqId = interaction.options.getInteger('id');
    
    try {
        const faq = await prisma.fAQ.findUnique({
            where: { id: faqId }
        });

        if (!faq) {
            return interaction.editReply({
                content: `❌ FAQ with ID ${faqId} not found.`
            });
        }

        // Increment view count
        await prisma.fAQ.update({
            where: { id: faqId },
            data: { views: faq.views + 1 }
        });

        const embed = new EmbedBuilder()
            .setTitle(`❓ ${faq.question}`)
            .setDescription(faq.answer)
            .addFields(
                { name: '📂 Category', value: faq.category, inline: true },
                { name: '👀 Views', value: faq.views.toString(), inline: true },
                { name: '📊 Helpful', value: `👍 ${faq.helpful} | 👎 ${faq.notHelpful}`, inline: true }
            )
            .setColor(0x00AE86)
            .setFooter({ text: `FAQ ID: ${faq.id}` })
            .setTimestamp();

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

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

        logger.info(`FAQ ${faqId} viewed by ${interaction.user.tag}`);
    } catch (error) {
        logger.error('Error viewing FAQ:', error);
        await interaction.editReply({
            content: '❌ Error fetching FAQ. Please try again.'
        });
    }
}