const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

class FAQSearchService {
    /**
     * Find relevant FAQs based on ticket content and category
     */
    async findRelevantFAQs(subject, category, limit = 3) {
        try {
            const keywords = this.extractKeywords(subject);
            
            if (keywords.length === 0) {
                return await this.findByCategory(category, limit);
            }

            const faqs = await prisma.fAQ.findMany({
                where: {
                    OR: [
                        { category: category },
                        ...keywords.map(kw => ({
                            question: { contains: kw, mode: 'insensitive' }
                        })),
                        ...keywords.map(kw => ({
                            answer: { contains: kw, mode: 'insensitive' }
                        })),
                        { keywords: { hasSome: keywords.map(k => k.toLowerCase()) } }
                    ]
                },
                orderBy: [
                    { views: 'desc' },
                    { helpful: 'desc' }
                ],
                take: limit * 2
            });

            const scoredFAQs = faqs.map(faq => ({
                ...faq,
                relevanceScore: this.calculateRelevanceScore(faq, keywords, category)
            }));

            return scoredFAQs
                .sort((a, b) => b.relevanceScore - a.relevanceScore)
                .slice(0, limit)
                .filter(faq => faq.relevanceScore > 0.2);

        } catch (error) {
            logger.error('Error searching FAQs:', error);
            return [];
        }
    }

    /**
     * Extract meaningful keywords from text
     */
    extractKeywords(text) {
        const stopWords = new Set([
            'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its',
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
            'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are',
            'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'must',
            'can', 'cannot', "can't", 'not', 'no', 'yes', 'this', 'that',
            'these', 'those', 'what', 'which', 'who', 'whom', 'where',
            'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
            'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
            'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here',
            'there', 'then', 'once', 'if', 'any', 'about', 'after', 'before',
            'help', 'need', 'want', 'please', 'thanks', 'thank', 'issue',
            'problem', 'question', 'getting', 'having', 'trying'
        ]);

        const words = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, ' ')
            .split(/\s+/)
            .filter(word => 
                word.length > 2 && 
                !stopWords.has(word) &&
                !/^\d+$/.test(word)
            );

        return [...new Set(words)];
    }

    /**
     * Calculate relevance score for an FAQ
     */
    calculateRelevanceScore(faq, keywords, category) {
        let score = 0;

        // Category match is important
        if (faq.category === category) {
            score += 0.4;
        }

        // Check keyword matches in question (higher weight)
        const questionLower = faq.question.toLowerCase();
        keywords.forEach(kw => {
            if (questionLower.includes(kw)) {
                score += 0.2;
            }
        });

        // Check keyword matches in answer
        const answerLower = faq.answer.toLowerCase();
        keywords.forEach(kw => {
            if (answerLower.includes(kw)) {
                score += 0.1;
            }
        });

        // Check stored keywords
        const faqKeywords = faq.keywords.map(k => k.toLowerCase());
        keywords.forEach(kw => {
            if (faqKeywords.includes(kw)) {
                score += 0.15;
            }
        });

        // Boost popular/helpful FAQs slightly
        if (faq.views > 10) score += 0.05;
        if (faq.helpful > 5) score += 0.05;

        return Math.min(score, 1);
    }

    /**
     * Find FAQs by category only
     */
    async findByCategory(category, limit) {
        try {
            return await prisma.fAQ.findMany({
                where: { category },
                orderBy: [
                    { views: 'desc' },
                    { helpful: 'desc' }
                ],
                take: limit
            });
        } catch (error) {
            logger.error('Error finding FAQs by category:', error);
            return [];
        }
    }

    /**
     * Get user's previous tickets for context
     */
    async getUserTicketHistory(userId, guildId, excludeTicketId = null) {
        try {
            const where = {
                userId,
                guildId,
                status: { in: ['closed', 'open', 'claimed'] }
            };

            if (excludeTicketId) {
                where.id = { not: excludeTicketId };
            }

            return await prisma.ticket.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    subject: true,
                    category: true,
                    status: true,
                    createdAt: true
                }
            });
        } catch (error) {
            logger.error('Error fetching user ticket history:', error);
            return [];
        }
    }
}

module.exports = new FAQSearchService();