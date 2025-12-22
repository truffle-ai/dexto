#!/usr/bin/env node
/**
 * Supabase Storage Distribution - Entry Point
 *
 * This demonstrates how to build a complete Dexto distribution with:
 * - Custom storage providers (Supabase)
 * - Custom tools (DateTime Helper)
 * - Multiple agent configurations
 *
 * Think of this like building your own Linux distribution on top of the kernel.
 */

import { DextoAgent } from '@dexto/core';
import { registerProviders, initialize, cleanup, projectConfig } from '../dexto.config.js';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
    console.log(`🚀 Starting ${projectConfig.name} v${projectConfig.version}\n`);
    console.log(`${projectConfig.description}\n`);

    try {
        // Step 1: Initialize the distribution
        // This is where you'd set up monitoring, analytics, etc.
        await initialize();

        // Step 2: Register all custom providers
        // This makes custom storage and tools available to agents
        await registerProviders();
        console.log();

        // Step 3: Load agent configuration from YAML
        const agentPath = process.argv[2] || join(__dirname, '../agents/default.yml');
        console.log(`📋 Loading agent configuration: ${agentPath}`);

        const configYaml = readFileSync(agentPath, 'utf-8');
        const config = parse(configYaml);

        // Step 4: Create the agent with the loaded config
        // The agent will automatically use the registered providers
        console.log(`🤖 Creating agent with ${config.llm?.provider}/${config.llm?.model}...`);
        const agent = new DextoAgent(config);

        // Step 5: Start the agent
        await agent.start();
        console.log(`✓ Agent started successfully\n`);

        // Step 6: Run a sample interaction
        const message = process.argv[3] || 'What is the current date and time in New York?';
        console.log(`💬 User: ${message}\n`);

        const response = await agent.run(message, undefined, undefined, 'example-session');
        console.log(`🤖 Agent: ${response}\n`);

        // Step 7: Cleanup
        await agent.stop();
        await cleanup();

        console.log(`\n✓ ${projectConfig.name} completed successfully`);
    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
