const axios = require('axios');
const logger = require('../utils/logger');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

class ClaudeService {
    constructor() {
        this.apiKey = process.env.CLAUDE_API_KEY;
        if (!this.apiKey) {
            logger.warn('CLAUDE_API_KEY not set - AI features will be disabled');
        }
    }

    /**
     * Generate an initial response for a new support ticket
     */
    async generateInitialResponse(ticket, relevantFAQs = [], ticketHistory = []) {
        if (!this.apiKey) {
            return this.getFallbackResponse(ticket);
        }

        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildTicketPrompt(ticket, relevantFAQs, ticketHistory);

        try {
            const response = await axios.post(
                CLAUDE_API_URL,
                {
                    model: CLAUDE_MODEL,
                    max_tokens: 1024,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    timeout: 30000
                }
            );

            const aiResponse = response.data.content[0].text;
            logger.info(`Claude response generated for ticket: ${ticket.subject}`);
            return aiResponse;

        } catch (error) {
            logger.error('Claude API error:', error.response?.data || error.message);
            return this.getFallbackResponse(ticket);
        }
    }

    /**
     * Build the system prompt for Claude
     */
    buildSystemPrompt() {
        return `You are Weaver, a friendly and helpful Discord support bot for the Discord Developers community. Your role is to provide an initial response when a new support ticket is created.

Your goals:
1. Warmly acknowledge the user's ticket and let them know a staff member will claim and assist them soon
2. If relevant FAQs are provided that directly answer their question, share that information helpfully
3. Encourage the user to provide additional helpful context while they wait (screenshots, error messages, API responses, application IDs, etc.)
4. Be concise but warm - aim for 2-4 short paragraphs maximum
5. Use Discord markdown formatting appropriately (bold, code blocks, etc.)

Guidelines:
- Never make up information - only reference FAQs if they're provided and relevant
- Don't promise specific response times
- If the issue seems urgent or complex, acknowledge that and reassure them staff will help
- Match the tone to the category (technical issues = more precise, general questions = more conversational)
- End with an encouraging note about providing more details if they have them

You are NOT resolving the ticket - you're providing a helpful first response while they wait for human support.`;
    }

    /**
     * Build the user prompt with ticket context
     */
    buildTicketPrompt(ticket, relevantFAQs, ticketHistory) {
        let prompt = `A new support ticket has been created. Please provide a helpful initial response.

        **Ticket Details:**
        - Subject: ${ticket.subject}
        - Category: ${ticket.category}
        - User ID: ${ticket.userId}
        `;

        if (ticketHistory.length > 0) {
            prompt += `\n**User's Previous Tickets (for context):**\n`;
            ticketHistory.slice(0, 3).forEach((t, i) => {
                prompt += `${i + 1}. [${t.category}] ${t.subject} - Status: ${t.status}\n`;
            });
        }

        if (relevantFAQs.length > 0) {
            prompt += `\n**Potentially Relevant FAQs:**\n`;
            relevantFAQs.forEach((faq, i) => {
                prompt += `\n${i + 1}. **Q:** ${faq.question}\n   **A:** ${faq.answer}\n`;
            });
            prompt += `\nIf any of these FAQs directly address the user's question, include that information in your response. If they're not relevant, don't mention them.`;
        } else {
            prompt += `\n*No directly relevant FAQs found for this ticket.*`;
        }

        prompt += `\n\nGenerate a helpful initial response for this ticket:`;
        return prompt;
    }

    /**
     * Fallback response when Claude API is unavailable
     */
    getFallbackResponse(ticket) {
        const categoryTips = {
            'App Directory': 'app listing details, screenshots of any issues, or your application ID',
            'App Name Change': 'your current app name, desired new name, and application ID',
            'API & Gateway': 'error codes, API responses, relevant code snippets, or gateway event logs',
            'Developer Community Perks': 'your developer profile or any eligibility questions',
            'Premium Apps': 'your monetization setup details or SKU information',
            'Social SDK': 'SDK version, platform details, and any error messages',
            'Teams & Ownership': 'team ID, current ownership details, or transfer requirements',
            'Verification & Intents': 'your application ID, current verification status, or intent requirements',
            'Webhooks': 'webhook URL issues, delivery failures, or payload examples'
        };

        const tip = categoryTips[ticket.category] || 'any relevant details, screenshots, or error messages';

        return `👋 Thanks for reaching out! Your ticket has been received and a support team member will claim it and assist you as soon as possible.

While you wait, it would be helpful if you could share any additional context like **${tip}**. The more details you provide, the faster we can help!

We appreciate your patience! 🙏`;
    }

    /**
     * Generate an escalation reminder message
     */
    async generateEscalationReminder(ticket) {
        if (!this.apiKey) {
            return `⚠️ **Ticket Requires Attention**\n\nTicket #${ticket.id} ("${ticket.subject}") has been open for over 24 hours without staff response. Please review and claim this ticket.`;
        }

        try {
            const response = await axios.post(
                CLAUDE_API_URL,
                {
                    model: CLAUDE_MODEL,
                    max_tokens: 256,
                    system: 'You are a support ticket management assistant. Generate a brief, professional escalation notice for staff about an unattended ticket. Be concise - 2-3 sentences max.',
                    messages: [{
                        role: 'user',
                        content: `Generate an escalation notice for this ticket that's been waiting 24+ hours:
                            - Ticket ID: #${ticket.id}
                            - Subject: ${ticket.subject}
                            - Category: ${ticket.category}
                            - Created: ${ticket.createdAt}
                            - User: <@${ticket.userId}>`
                    }]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    timeout: 15000
                }
            );

            return response.data.content[0].text;

        } catch (error) {
            logger.error('Claude escalation API error:', error.message);
            return `⚠️ **Ticket Requires Attention**\n\nTicket #${ticket.id} ("${ticket.subject}") has been open for over 24 hours without staff response.`;
        }
    }
}

module.exports = new ClaudeService();