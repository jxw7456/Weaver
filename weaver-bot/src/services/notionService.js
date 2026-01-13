/**
 * Notion Integration Service for Weaver Bot
 * 
 * Configured for: Cross Domain Ticket Tracker
 * Database: https://www.notion.so/discordapp/1ddf46fd48aa806e9693d3a0e8dd9238
 * 
 * Database Schema:
 * - Ticket ID Link (title) - Discord thread link with ticket ID
 * - Domain (select) - Category/domain of the ticket
 * - Ticket Summary (text) - Summary of the issue
 * - Ticket Response (text) - Staff response/resolution
 * - Priority (select) - P0, P1, P2
 * - Added (date) - When added to tracker
 * - Created By (person) - Who added to Notion
 * - Macro Needed (checkbox) - If a macro is needed
 * - [NO TOUCH] Macro Status (status) - Macro workflow status
 */

const logger = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');

const prisma = require('../utils/prisma');

// Notion API Configuration
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '1ddf46fd-48aa-806d-8a19-000b64b08ad1';

// Map Weaver categories to Notion Domain values
const CATEGORY_TO_DOMAIN = {
    'App Directory': 'App Directory',
    'App Name Change': 'Verified App Name Change Request',
    'API & Gateway': 'API & Gateway',
    'Developer Community Perks': 'Developer Community Perks',
    'Premium Apps': 'Premium Apps',
    'Social SDK': 'Social SDK',
    'Teams & Ownership': 'Developer Product Ownership Transfer Request',
    'Verification & Intents': 'App Verification and Intents',
    'Webhooks': 'Webhooks'
};

// Map Weaver priority to Notion priority
const PRIORITY_TO_NOTION = {
    'urgent': 'P0',
    'high': 'P0',
    'normal': 'P1',
    'low': 'P2'
};

class NotionService {
    constructor() {
        this.isConfigured = !!NOTION_API_KEY;
        this.client = null;
        
        if (this.isConfigured) {
            // Lazy load Notion client when needed
            try {
                const { Client } = require('@notionhq/client');
                this.client = new Client({ auth: NOTION_API_KEY });
                logger.info('Notion client initialized');
            } catch (err) {
                logger.warn('Notion SDK not installed. Run: npm install @notionhq/client');
                this.isConfigured = false;
            }
        } else {
            logger.warn('Notion API key not configured - Notion export features disabled');
        }
    }

    /**
     * Check if Notion integration is available
     */
    isAvailable() {
        return this.isConfigured && this.client !== null;
    }

    /**
     * Export a tracked ticket to Notion
     * @param {number} ticketId - The ticket ID to export
     * @param {string} exportedBy - User ID who triggered the export
     * @returns {Promise<{success: boolean, pageId?: string, pageUrl?: string, error?: string}>}
     */
    async exportTicket(ticketId, exportedBy) {
        if (!this.isAvailable()) {
            return { 
                success: false, 
                error: 'Notion integration not configured. Set NOTION_API_KEY in environment and install @notionhq/client.' 
            };
        }

        try {
            // Fetch ticket data
            const tracked = await prisma.trackedTicket.findUnique({
                where: { ticketId }
            });

            if (!tracked) {
                return { success: false, error: 'Ticket not found in tracking system' };
            }

            const ticket = await prisma.ticket.findUnique({
                where: { id: ticketId },
                include: { feedback: true }
            });

            if (!ticket) {
                return { success: false, error: 'Ticket not found' };
            }

            // Build Notion page properties
            const properties = this.buildPageProperties(ticket, tracked);

            // Create the page in Notion
            const response = await this.client.pages.create({
                parent: { database_id: NOTION_DATABASE_ID },
                properties: properties
            });

            const pageId = response.id;
            const pageUrl = response.url;

            // Update tracking record with Notion page ID
            await prisma.trackedTicket.update({
                where: { ticketId },
                data: {
                    notionPageId: pageId,
                    exportedAt: new Date(),
                    status: 'exported'
                }
            });

            // Update ticket record
            await prisma.ticket.update({
                where: { id: ticketId },
                data: { notionPageId: pageId }
            });

            logger.info(`Ticket #${ticketId} exported to Notion: ${pageUrl}`);

            return {
                success: true,
                pageId: pageId,
                pageUrl: pageUrl
            };

        } catch (error) {
            logger.error('Error exporting to Notion:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Build Notion page properties from ticket data
     * Matches the Cross Domain Ticket Tracker schema
     */
    buildPageProperties(ticket, tracked) {
        const threadUrl = `https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`;
        const domain = CATEGORY_TO_DOMAIN[ticket.category] || 'API & Gateway';
        const priority = PRIORITY_TO_NOTION[tracked.priority] || 'P1';

        // Build ticket summary from feedback and notes
        let summary = `Rating: ${ticket.feedback?.rating || 'N/A'}/5\n`;
        summary += `User Feedback: ${ticket.feedback?.comment || 'No feedback provided'}\n`;
        if (tracked.notes) {
            summary += `\nReview Notes: ${tracked.notes}`;
        }

        return {
            // Title property - Discord thread link
            'Ticket ID Link': {
                title: [{ 
                    text: { 
                        content: `#${ticket.id} - ${ticket.subject}`,
                        link: { url: threadUrl }
                    } 
                }]
            },
            // Domain/Category
            'Domain': {
                select: { name: domain }
            },
            // Ticket Summary
            'Ticket Summary': {
                rich_text: [{ 
                    text: { content: summary.substring(0, 2000) } 
                }]
            },
            // Priority
            'Priority': {
                select: { name: priority }
            },
            // Added date
            'Added': {
                date: { start: new Date().toISOString().split('T')[0] }
            },
            // Macro Needed - default to false, can be updated in Notion
            'Macro Needed': {
                checkbox: false
            }
        };
    }

    /**
     * Update an existing Notion page
     */
    async updateNotionPage(pageId, updates) {
        if (!this.isAvailable()) {
            return { success: false, error: 'Notion not configured' };
        }

        try {
            const response = await this.client.pages.update({
                page_id: pageId,
                properties: updates
            });

            return { success: true, pageId: response.id };
        } catch (error) {
            logger.error('Error updating Notion page:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Add ticket response to Notion page
     */
    async addTicketResponse(ticketId, response) {
        const tracked = await prisma.trackedTicket.findUnique({
            where: { ticketId }
        });

        if (!tracked?.notionPageId) {
            return { success: false, error: 'Ticket not exported to Notion yet' };
        }

        return this.updateNotionPage(tracked.notionPageId, {
            'Ticket Response': {
                rich_text: [{ text: { content: response.substring(0, 2000) } }]
            }
        });
    }

    /**
     * Batch export multiple tickets
     */
    async batchExport(ticketIds, exportedBy) {
        const results = [];
        
        for (const ticketId of ticketIds) {
            const result = await this.exportTicket(ticketId, exportedBy);
            results.push({ ticketId, ...result });
            
            // Rate limiting - Notion API allows 3 requests per second
            await new Promise(resolve => setTimeout(resolve, 350));
        }
        
        return results;
    }

    /**
     * Generate export data for manual copy (when API not configured)
     * Returns data formatted for easy copying to Notion
     */
    async generateExportData(ticketId) {
        const tracked = await prisma.trackedTicket.findUnique({
            where: { ticketId }
        });

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { feedback: true }
        });

        if (!ticket || !tracked) {
            return null;
        }

        const domain = CATEGORY_TO_DOMAIN[ticket.category] || ticket.category;
        const priority = PRIORITY_TO_NOTION[tracked.priority] || 'P1';

        return {
            // Ready to paste into Notion
            'Ticket ID Link': `#${ticket.id} - ${ticket.subject}`,
            'Thread URL': `https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`,
            'Domain': domain,
            'Ticket Summary': [
                `Rating: ${ticket.feedback?.rating || 'N/A'}/5`,
                `User Feedback: ${ticket.feedback?.comment || 'No feedback'}`,
                tracked.notes ? `Review Notes: ${tracked.notes}` : null
            ].filter(Boolean).join('\n'),
            'Priority': priority,
            'Added': new Date().toISOString().split('T')[0],
            
            // Additional context (not in Notion schema but useful)
            _meta: {
                ticketId: ticket.id,
                userId: ticket.userId,
                assignedTo: ticket.assignedTo,
                createdAt: ticket.createdAt,
                closedAt: ticket.closedAt,
                rating: ticket.feedback?.rating
            }
        };
    }

    /**
     * Get all export-ready tickets with their formatted data
     */
    async getExportReadyData() {
        const exportReady = await prisma.trackedTicket.findMany({
            where: {
                status: 'exported',
                notionPageId: null
            }
        });

        const results = [];
        for (const tracked of exportReady) {
            const data = await this.generateExportData(tracked.ticketId);
            if (data) {
                results.push(data);
            }
        }

        return results;
    }

    /**
     * Check if a ticket has already been exported
     */
    async isExported(ticketId) {
        const tracked = await prisma.trackedTicket.findUnique({
            where: { ticketId }
        });
        return tracked?.notionPageId !== null;
    }
}

module.exports = new NotionService();