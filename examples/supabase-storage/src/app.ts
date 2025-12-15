/**
 * Example Application: Dexto Agent with Supabase Blob Storage + Custom Tools
 *
 * This demonstrates how to build a custom application that uses Dexto with:
 * - Custom blob storage provider (Supabase)
 * - Custom tool provider (DateTime Helper)
 *
 * Architecture:
 * 1. Register custom providers (blob storage + tools) to global registries
 * 2. Load agent configuration from YAML file
 * 3. Create and start DextoAgent
 * 4. Use the agent (run conversations, access tools, etc.)
 *
 * This is a STANDALONE application - completely separate from the Dexto CLI.
 * You could deploy this as a web server, Discord bot, CLI tool, etc.
 */

import { DextoAgent, blobStoreRegistry, customToolRegistry } from '@dexto/core';
import { supabaseBlobStoreProvider } from './supabase-provider.js';
import { dateTimeToolProvider } from './datetime-tool-provider.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log('🚀 Starting Dexto agent with custom providers...\n');

    // Step 1: Register custom providers BEFORE loading agent config
    // This makes them available when the agent config is loaded

    // Register blob storage provider
    blobStoreRegistry.register(supabaseBlobStoreProvider);
    console.log('✓ Registered Supabase blob storage provider');

    // Register custom tool provider
    customToolRegistry.register(dateTimeToolProvider);
    console.log('✓ Registered DateTime Helper tool provider\n');

    // Step 2: Create agent with config
    // Note: In a real application, you would load this from agent.yml
    // For this example, we use a minimal inline config for demonstration
    const agent = new DextoAgent({
        systemPrompt: {
            contributors: [
                {
                    id: 'primary',
                    type: 'static',
                    priority: 0,
                    content:
                        'You are a helpful AI assistant with access to blob storage and datetime utilities.',
                },
            ],
        },
        llm: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250514',
            apiKey: process.env.ANTHROPIC_API_KEY || '',
        },
        storage: {
            cache: { type: 'in-memory' },
            database: { type: 'in-memory' },
            blob: {
                type: 'supabase',
                supabaseUrl: process.env.SUPABASE_URL || '',
                supabaseKey: process.env.SUPABASE_KEY || '',
                bucket: 'dexto-blobs',
                maxBlobSize: 52428800,
                maxTotalSize: 1073741824,
                cleanupAfterDays: 30,
            },
        },
        internalTools: ['read_file', 'write_file', 'glob_files'],
        customTools: [
            {
                type: 'datetime-helper',
                defaultTimezone: 'America/New_York',
                includeMilliseconds: false,
            },
        ],
        toolConfirmation: {
            mode: 'auto-approve',
        },
    });

    console.log('🔧 Starting agent...');
    await agent.start();
    console.log('✓ Agent started\n');

    // Step 4: Use the agent with custom tools
    console.log('💬 Sending test message...\n');

    const response = await agent.run(
        'Hello! Please do two things: (1) Get the current date and time, and (2) create a file called "timestamp.txt" ' +
            'containing the current timestamp. Use both the datetime tool and the file writing capability.',
        undefined, // No image data
        undefined, // No file data
        'example-session' // Session ID
    );

    console.log('📝 Agent response:');
    console.log(response);

    console.log('\n✅ Done!');
    console.log('\nℹ️  What happened:');
    console.log('   - Used custom datetime tool (custom--get_datetime)');
    console.log('   - Stored file in Supabase Storage (not local filesystem)');
    console.log('   - Check your Supabase dashboard under Storage → dexto-blobs\n');

    // Cleanup
    await agent.stop();
}

// Run the app
main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
