const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const logger = require('../../utils/logger');

const prisma = require('../utils/prisma');

// FAQ Management Command
module.exports = {
    data: new SlashCommandBuilder()
        .setName('faq-manage')
        .setDescription('Manage FAQ entries (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new FAQ')
                .addStringOption(option =>
                    option.setName('question')
                        .setDescription('The question')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('answer')
                        .setDescription('The answer')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('category')
                        .setDescription('FAQ category')
                        .setRequired(true)
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
                .addStringOption(option =>
                    option.setName('keywords')
                        .setDescription('Comma-separated keywords for search')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Edit an existing FAQ')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('FAQ ID to edit')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('question')
                        .setDescription('New question (leave empty to keep current)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('answer')
                        .setDescription('New answer (leave empty to keep current)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete an FAQ')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('FAQ ID to delete')
                        .setRequired(true)
                )
        ),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            await handleAdd(interaction);
        } else if (subcommand === 'edit') {
            await handleEdit(interaction);
        } else if (subcommand === 'delete') {
            await handleDelete(interaction);
        }
    }
};

// Add FAQ handler
async function handleAdd(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const question = interaction.options.getString('question');
    const answer = interaction.options.getString('answer');
    const category = interaction.options.getString('category');
    const keywordsStr = interaction.options.getString('keywords') || '';
    const keywords = keywordsStr.split(',').map(k => k.trim().toLowerCase()).filter(k => k);

    try {
        const faq = await prisma.fAQ.create({
            data: {
                question,
                answer,
                category,
                keywords
            }
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ FAQ Added')
            .setDescription(`FAQ #${faq.id} has been created successfully.`)
            .addFields(
                { name: 'Question', value: question },
                { name: 'Category', value: category }
            )
            .setColor(0x00FF00)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`FAQ #${faq.id} created by ${interaction.user.tag}`);
    } catch (error) {
        logger.error('Error creating FAQ:', error);
        await interaction.editReply({
            content: '❌ Failed to create FAQ. Please try again.'
        });
    }
}

// Edit FAQ handler
async function handleEdit(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const id = interaction.options.getInteger('id');
    const question = interaction.options.getString('question');
    const answer = interaction.options.getString('answer');

    try {
        const updateData = {};
        if (question) updateData.question = question;
        if (answer) updateData.answer = answer;

        if (Object.keys(updateData).length === 0) {
            return interaction.editReply({
                content: '❌ Please provide at least one field to update.'
            });
        }

        const faq = await prisma.fAQ.update({
            where: { id },
            data: updateData
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ FAQ Updated')
            .setDescription(`FAQ #${faq.id} has been updated successfully.`)
            .setColor(0x00FF00)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`FAQ #${id} updated by ${interaction.user.tag}`);
    } catch (error) {
        logger.error('Error updating FAQ:', error);
        await interaction.editReply({
            content: `❌ Failed to update FAQ #${id}. Make sure the ID exists.`
        });
    }
}

// Delete FAQ handler
async function handleDelete(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const id = interaction.options.getInteger('id');

    try {
        await prisma.fAQ.delete({
            where: { id }
        });

        await interaction.editReply({
            content: `✅ FAQ #${id} has been deleted successfully.`
        });
        
        logger.info(`FAQ #${id} deleted by ${interaction.user.tag}`);
    } catch (error) {
        logger.error('Error deleting FAQ:', error);
        await interaction.editReply({
            content: `❌ Failed to delete FAQ #${id}. Make sure the ID exists.`
        });
    }
}