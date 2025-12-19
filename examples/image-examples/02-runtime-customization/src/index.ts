/**
 * Example 2: Runtime Customization
 *
 * Pattern: Add custom tools at runtime without building a new image
 *
 * Steps:
 * 1. Import image for side-effect provider registration
 * 2. Register additional custom tools at runtime
 * 3. Create agent with DextoAgent
 *
 * Use Case: App-specific tools (1-2) that don't need to be distributed
 */

// Import from core packages
import { DextoAgent, customToolRegistry } from '@dexto/core';
import { loadAgentConfig } from '@dexto/agent-management';

// Import our custom tool provider
import { weatherToolProvider } from '../tools/weather-tool/index.js';

async function main() {
    console.log('🔧 Example 2: Runtime Customization\n');

    // STEP 1: Add custom tool at runtime (BEFORE creating agent)
    console.log('📦 Registering custom tool...');
    customToolRegistry.register(weatherToolProvider);
    console.log('✅ Registered: weather-helper');
    console.log('   Note: Added at runtime, no image build needed!\n');

    // STEP 2: Load agent configuration
    console.log('📝 Loading configuration...');
    const config = await loadAgentConfig('./agents/default.yml');
    console.log('✅ Config loaded (image: @dexto/image-local)\n');

    // STEP 3: Create agent
    console.log('🤖 Creating agent...');
    const agent = new DextoAgent(config, './agents/default.yml');
    console.log('✅ Agent created');
    console.log('   - Image providers: ✓ (filesystem, process tools)');
    console.log('   - Runtime additions: ✓ (weather tool)\n');

    // STEP 4: Start agent
    console.log('🔌 Starting agent...');
    await agent.start();
    console.log('✅ Agent started\n');

    // STEP 5: Create session
    console.log('📝 Creating session...');
    const session = await agent.createSession();
    console.log(`✅ Session: ${session.id}\n`);

    // STEP 6: Test the custom weather tool
    console.log('💬 Test: Using runtime-added weather tool...');
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
    console.log('Key Takeaways:');
    console.log('  ✓ Imported image: import "@dexto/image-local"');
    console.log('  ✓ Registered tool at runtime: customToolRegistry.register()');
    console.log('  ✓ No build step required - instant iteration');
    console.log('  ✓ Perfect for app-specific tools (1-2)');
    console.log('  ✓ For 3+ tools, consider Example 3 (build-time extension)');
}

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
