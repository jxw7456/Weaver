const axios = require('axios');
const logger = require('../utils/logger');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Documentation links by category
const DOCUMENTATION_LINKS = {
    'App Directory': {
        helpCenter: 'https://support-dev.discord.com/hc/en-us/sections/31439707456663-Discovery',
        apiDocs: 'https://discord.com/developers/docs/resources/application#application-object'
    },
    'App Name Change': {
        helpCenter: 'https://support-dev.discord.com/hc/en-us/articles/6129090215959-How-Do-I-Change-My-Bot-s-Name',
        apiDocs: 'https://discord.com/developers/docs/resources/application#edit-current-application'
    },
    'API & Gateway': {
        helpCenter: 'https://support-dev.discord.com/hc/en-us/articles/6223003921559-My-Bot-is-Being-Rate-Limited',
        apiDocs: 'https://discord.com/developers/docs/topics/gateway',
        rateLimits: 'https://discord.com/developers/docs/topics/rate-limits'
    },
    'Developer Community Perks': {
        helpCenter: 'https://support-dev.discord.com/hc/en-us/articles/10113997751447-Active-Developer-Badge',
        apiDocs: 'https://discord.com/developers/docs/tutorials/developing-a-user-installable-app'
    },
    'Premium Apps': {
        helpCenter: 'https://support-dev.discord.com/hc/en-us/sections/17294380054935-Monetization',
        apiDocs: 'https://discord.com/developers/docs/monetization/overview'
    },
    'Social SDK': {
        helpCenter: 'https://support-dev.discord.com/hc/categories/30608732211607',
        apiDocs: 'https://discord.com/developers/docs/developer-tools/embedded-app-sdk'
    },
    'Teams & Ownership': {
        helpCenter: 'https://support-dev.discord.com/hc/categories/360000656531',
        apiDocs: 'https://discord.com/developers/docs/topics/teams'
    },
    'Verification & Intents': {
        helpCenter: 'https://support-dev.discord.com/hc/en-us/sections/5324794669207-Privileged-Gateway-Intents',
        apiDocs: 'https://discord.com/developers/docs/topics/gateway#gateway-intents',
        privilegedIntents: 'https://discord.com/developers/docs/topics/gateway#privileged-intents'
    },
    'Webhooks': {
        helpCenter: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
        apiDocs: 'https://discord.com/developers/docs/resources/webhook'
    }
};

class ClaudeService {
    constructor() {
        this.apiKey = process.env.CLAUDE_API_KEY;
        if (!this.apiKey) {
            logger.warn('CLAUDE_API_KEY not set - AI features will be disabled');
        }
    }

    /**
     * Get documentation links for a category
     */
    getDocsForCategory(category) {
        return DOCUMENTATION_LINKS[category] || {
            helpCenter: 'https://support-dev.discord.com/hc/en-us',
            apiDocs: 'https://discord.com/developers/docs'
        };
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
4. **Always include relevant documentation links** from the Discord Help Center and/or Discord Developer Documentation when applicable
5. Be concise but warm - aim for 2-4 short paragraphs maximum
6. Use Discord markdown formatting appropriately (bold, code blocks, etc.)

Documentation Link Guidelines:
- Include links to relevant Discord Help Center articles (support.discord.com) when the issue relates to user-facing features or general questions
- Include links to Discord Developer Documentation (discord.com/developers/docs) when the issue is technical or API-related
- Format links naturally within your response, e.g., "You can find more information in the [Gateway documentation](https://discord.com/developers/docs/topics/gateway)"
- Don't overwhelm with links - include 1-3 most relevant links maximum

Guidelines:
- Never try to obtain sensitive information (passwords, payment info, etc.)
- Never make up information - only reference FAQs if they're provided and relevant
- Don't promise specific response times
- If the issue seems urgent or complex, acknowledge that and reassure them staff will help
- Match the tone to the category (technical issues = more precise, general questions = more conversational)
- End with an encouraging note about providing more details if they have them
- If any of the following CX scopes are mentioned, redirect the user to Discord CX support form:
        - Requests the clearly ask for CX or Customer Support assistance
        - Verification issues (either email or SMS, ex: unclaimed account)
        - Feature Request/Feedback
        - Server setup and optimization
        - Moderation best practices
        - Subscription questions (Nitro, Server Boosting, etc)
        - Server Boosting questions (how to use on a server to unlock features, etc)
        - Vanity URL inquiries (either to claim/unlock one, issue with setting one, or stolen one)
        - Community feature activation
        - Impersonation/legal issues
        - Permission and role management
        - Integration access concerns
        - Server issues
            - Stuck channel/unable to delete a channel
            - Server Outages

You are NOT resolving the ticket - you're providing a helpful first response while they wait for human support.`;
    }

    /**
     * Build the user prompt with ticket context
     */
    buildTicketPrompt(ticket, relevantFAQs, ticketHistory) {
        const docs = this.getDocsForCategory(ticket.category);

        let prompt = `A new support ticket has been created. Please provide a helpful initial response.

        **Ticket Details:**
        - Subject: ${ticket.subject}
        - Category: ${ticket.category}
        - User ID: ${ticket.userId}

        **Relevant Documentation Links for this category:**
        - Help Center: ${docs.helpCenter}
        - API Documentation: ${docs.apiDocs}`;

        // Add additional docs if available
        if (docs.rateLimits) {
            prompt += `\n- Rate Limits: ${docs.rateLimits}`;
        }
        if (docs.privilegedIntents) {
            prompt += `\n- Privileged Intents: ${docs.privilegedIntents}`;
        }

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

        prompt += `\n\nRemember to include 1-2 relevant documentation links naturally in your response. Generate a helpful initial response for this ticket:`;
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

📚 **Helpful Resources:**
• [Discord Help Center](${docs.helpCenter})
• [Developer Documentation](${docs.apiDocs})

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