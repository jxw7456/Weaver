const { Events } = require('discord.js');
const escalationService = require('../services/escalationService');
const logger = require('../utils/logger');

/**
 * Mirrors follow-up messages from the triage thread (in Studio Connect) into
 * the partner-escalations thread (in UDP).
 *
 * The "is this thread being mirrored?" lookup happens inside the service —
 * this handler stays thin and just gates on the obvious skip cases.
 *
 * Loop prevention: filtering on `author.bot` covers our own forwarded
 * messages, since the bot is the author when we re-send a message into the
 * destination thread. Without this filter, every mirrored message would
 * trigger another mirror. Only triage threads have a
 * DB row, so even if a bot message slipped through, the destination thread
 * isn't in the table and the lookup returns null.
 */
module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;
        if (!message.channel?.isThread?.()) return;

        try {
            await escalationService.maybeForwardMessage(message);
        } catch (err) {
            logger.error('messageCreate forwarder error:', err);
        }
    }
};