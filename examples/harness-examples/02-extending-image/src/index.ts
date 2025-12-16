/**
 * Example 2: Extending an Official Image
 *
 * This demonstrates how to:
 * 1. Start with an official base image (@dexto/image-local)
 * 2. Add your own custom providers (weather tool)
 * 3. Use both the image's providers AND your custom ones
 *
 * Use Case: You want the convenience of an official image but need
 * to add organization-specific or domain-specific tools.
 */

// Import from local harness implementation (Example 0)
import { createAgent, imageMetadata } from '../../00-harness-implementation/dist/index.js';
import { loadAgentConfig } from '@dexto/agent-management';
import { customToolRegistry } from '@dexto/core';
import { weatherToolProvider } from '../tools/weather-tool.js';

async function main() {
    console.log('🔧 Example 2: Extending an Official Image\n');

    // Show what base image we're using
    console.log('Base Image:');
    console.log(`  ${imageMetadata.name} v${imageMetadata.version}`);
    console.log(`  Target: ${imageMetadata.target}\n`);

    // STEP 1: Extend the image with custom provider
    console.log('📦 Extending image with custom provider...');
    customToolRegistry.register(weatherToolProvider);
    console.log('✅ Registered custom tool: weather-helper\n');

    // STEP 2: Load agent configuration
    console.log('📝 Loading agent configuration...');
    const config = await loadAgentConfig('./agents/default.yml');
    console.log('✅ Config loaded\n');

    // STEP 3: Create agent
    console.log('🤖 Creating agent...');
    const agent = createAgent(config, './agents/default.yml');
    console.log('✅ Agent created');
    console.log('   - Image providers: ✓ (SQLite, local storage, cache)');
    console.log('   - Custom providers: ✓ (weather tool)\n');

    // STEP 4: Start agent
    console.log('🔌 Starting agent...');
    await agent.start();
    console.log('✅ Agent started\n');

    // STEP 5: Create session
    console.log('📝 Creating session...');
    const session = await agent.createSession();
    console.log(`✅ Session created: ${session.id}\n`);

    // STEP 6: Test the custom tool
    console.log('💬 Testing custom weather tool...');
    const response = await agent.run(
        'What is the weather like in San Francisco?',
        undefined,
        undefined,
        session.id
    );

    console.log('📨 Agent response:');
    console.log(`   ${response}\n`);

    // STEP 7: Cleanup
    console.log('🛑 Stopping agent...');
    await agent.stop();
    console.log('✅ Agent stopped\n');

    console.log('✨ Example complete!\n');
    console.log('Key Takeaway:');
    console.log('  - Started with @dexto/image-local (official image)');
    console.log('  - Added custom weather tool via customToolRegistry');
    console.log('  - Agent has BOTH image providers AND custom tool');
    console.log('  - No need to register storage/database providers');
    console.log('  - Best of both worlds: convenience + customization 🎉');
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
