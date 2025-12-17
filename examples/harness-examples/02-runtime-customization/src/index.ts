/**
 * Example 2: Runtime Customization
 *
 * This demonstrates how to:
 * 1. Start with an official base image (@dexto/image-local)
 * 2. Add custom tools at runtime (weather tool)
 * 3. Use both the image's bundled tools AND your runtime additions
 *
 * Key Difference from Extending:
 * - This is RUNTIME customization (register at app startup)
 * - NOT creating a new image (no build step)
 * - Perfect for app-specific tools that don't need to be in the image
 *
 * Use Case: You want the convenience of an official image but need
 * to add 1-2 app-specific tools without building a new image.
 */

// Import from local harness implementation (Example 0)
// Note: customToolRegistry comes from the IMAGE, not @dexto/core!
import {
    createAgent,
    imageMetadata,
    customToolRegistry,
} from '../../00-building-image/dist/index.js';
import { loadAgentConfig } from '@dexto/agent-management';
import { weatherToolProvider } from '../tools/weather-tool/index.js';

async function main() {
    console.log('🔧 Example 2: Runtime Customization\n');

    // Show what base image we're using
    console.log('Base Image:');
    console.log(`  ${imageMetadata.name} v${imageMetadata.version}`);
    console.log(`  Target: ${imageMetadata.target}\n`);

    // STEP 1: Add custom tool at runtime (no image rebuild needed!)
    console.log('📦 Adding custom tool at runtime...');
    customToolRegistry.register(weatherToolProvider);
    console.log('✅ Registered custom tool: weather-helper');
    console.log('   Note: Registry imported from IMAGE, not @dexto/core!\n');

    // STEP 2: Load agent configuration
    console.log('📝 Loading agent configuration...');
    const config = await loadAgentConfig('./agents/default.yml');
    console.log('✅ Config loaded\n');

    // STEP 3: Create agent
    console.log('🤖 Creating agent...');
    const agent = createAgent(config, './agents/default.yml');
    console.log('✅ Agent created');
    console.log('   - Image providers: ✓ (SQLite, local storage, cache, text-utils)');
    console.log('   - Runtime additions: ✓ (weather tool)\n');

    // STEP 4: Start agent
    console.log('🔌 Starting agent...');
    await agent.start();
    console.log('✅ Agent started\n');

    // STEP 5: Create session
    console.log('📝 Creating session...');
    const session = await agent.createSession();
    console.log(`✅ Session created: ${session.id}\n`);

    // STEP 6: Test the custom weather tool
    console.log('💬 Test 1: Testing runtime-added weather tool...');
    const response1 = await agent.run(
        'What is the weather like in San Francisco?',
        undefined,
        undefined,
        session.id
    );
    console.log('📨 Agent response:');
    console.log(`   ${response1}\n`);

    // STEP 7: Test the text-utils tool from base image
    console.log('💬 Test 2: Testing text-utils from base image...');
    const response2 = await agent.run(
        'Count the words in: "hello world from runtime customization"',
        undefined,
        undefined,
        session.id
    );
    console.log('📨 Agent response:');
    console.log(`   ${response2}\n`);

    // STEP 8: Cleanup
    console.log('🛑 Stopping agent...');
    await agent.stop();
    console.log('✅ Agent stopped\n');

    console.log('✨ Example complete!\n');
    console.log('Key Takeaways:');
    console.log('  ✓ Started with @dexto/image-local (includes text-utils)');
    console.log('  ✓ Added weather tool at RUNTIME (no image build)');
    console.log('  ✓ Imported customToolRegistry from IMAGE, not @dexto/core');
    console.log('  ✓ No @dexto/core dependency needed!');
    console.log('  ✓ Used text-utils (from image) AND weather tool (runtime)');
    console.log('  ✓ Perfect for app-specific customization 🎉');
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
