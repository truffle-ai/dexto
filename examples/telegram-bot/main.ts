#!/usr/bin/env node

import 'dotenv/config';
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';
import { startTelegramBot } from './bot.js';

async function main() {
    try {
        // Load agent configuration from local agent-config.yml
        console.log('🚀 Initializing Telegram bot...');
        const configPath = './agent-config.yml';
        const config = await loadAgentConfig(configPath);
        const enrichedConfig = enrichAgentConfig(config, configPath);

        // Create and start the Dexto agent
        const agent = new DextoAgent(enrichedConfig, configPath);
        await agent.start();

        // Start the Telegram bot
        console.log('📡 Starting Telegram bot connection...');
        await startTelegramBot(agent);

        console.log('✅ Telegram bot is running! Start with /start command.');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down...');
            await agent.stop();
            process.exit(0);
        });
    } catch (error) {
        console.error('❌ Failed to start Telegram bot:', error);
        process.exit(1);
    }
}

main();
