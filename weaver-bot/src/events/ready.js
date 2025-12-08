const { Events } = require('discord.js');
const logger = require('../utils/logger');

// Ready event
module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        logger.info(`Logged in as ${client.user.tag}`);
        client.user.setActivity('Support Tickets | /ticket', { type: 'WATCHING' });
    }
};