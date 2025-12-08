require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const escalationScheduler = require('./services/escalationScheduler');

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
    ]
});

// Command collection
client.commands = new Collection();

// Load commands
const loadCommands = () => {
    const commandFolders = fs.readdirSync(path.join(__dirname, 'commands'));
    
    for (const folder of commandFolders) {
        const commandFiles = fs.readdirSync(path.join(__dirname, 'commands', folder))
            .filter(file => file.endsWith('.js'));
        
        for (const file of commandFiles) {
            const command = require(`./commands/${folder}/${file}`);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                logger.info(`Loaded command: ${command.data.name}`);
            }
        }
    }
};

// Load events
const loadEvents = () => {
    const eventFiles = fs.readdirSync(path.join(__dirname, 'events'))
        .filter(file => file.endsWith('.js'));
    
    for (const file of eventFiles) {
        const event = require(`./events/${file}`);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
        } else {
            client.on(event.name, (...args) => event.execute(...args));
        }
        logger.info(`Loaded event: ${event.name}`);
    }
};

// Initialize services when client is ready
client.once(Events.ClientReady, () => {
    logger.info(`Logged in as ${client.user.tag}`);
    
    // Initialize escalation scheduler with the client
    escalationScheduler.init(client);
    logger.info('All services initialized');
});

// Initialize
loadCommands();
loadEvents();

// Error handling
process.on('unhandledRejection', error => {
    logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    logger.error('Uncaught exception:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN);