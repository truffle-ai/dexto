#!/usr/bin/env node

import 'dotenv/config';
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';
import {
    AgentConfigSchema,
    applyImageDefaults,
    resolveServicesFromConfig,
    toDextoAgentOptions,
} from '@dexto/agent-config';
import imageLocal from '@dexto/image-local';
import { startDiscordBot } from './bot.js';

async function main() {
    try {
        // Load agent configuration from local agent-config.yml
        console.log('🚀 Initializing Discord bot...');
        const configPath = './agent-config.yml';
        const rawConfig = await loadAgentConfig(configPath);
        const withDefaults = applyImageDefaults(rawConfig, imageLocal.defaults);
        const enrichedConfig = enrichAgentConfig(withDefaults, configPath);
        const config = AgentConfigSchema.parse(enrichedConfig);
        const services = await resolveServicesFromConfig(config, imageLocal);

        // Create and start the Dexto agent
        const agent = new DextoAgent(toDextoAgentOptions({ config, services }));
        await agent.start();

        // Start the Discord bot
        console.log('📡 Starting Discord bot connection...');
        startDiscordBot(agent);

        console.log('✅ Discord bot is running! Send messages or use !ask <question> prefix.');
        console.log('   In DMs, just send your message without the !ask prefix.');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down...');
            await agent.stop();
            process.exit(0);
        });
    } catch (error) {
        console.error('❌ Failed to start Discord bot:', error);
        process.exit(1);
    }
}

main();
