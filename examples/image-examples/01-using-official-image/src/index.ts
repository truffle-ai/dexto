/**
 * Example 1: Using an Official Image
 *
 * This is the output of: dexto create-app my-app --from-image @dexto/image-local
 *
 * Pattern 1: Static Import
 * - Image is imported as a side-effect (auto-registers providers)
 * - Image is also specified in agents/default.yml config
 * - Use DextoAgent from @dexto/core (not createAgent from image)
 */

// Load image environment (Pattern 1: Static Import)
// This auto-registers providers as a side-effect
import '@dexto/image-local';

// Import from core packages
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig } from '@dexto/agent-management';

async function main() {
    console.log('🚀 Example 1: Using Official Image\n');

    // Load agent configuration
    console.log('📝 Loading configuration from agents/default.yml');
    const config = await loadAgentConfig('./agents/default.yml');
    console.log('✅ Config loaded (image: @dexto/image-local)\n');

    // Create agent - providers already registered by image import
    console.log('🤖 Creating agent...');
    const agent = new DextoAgent(config, './agents/default.yml');
    console.log('✅ Agent created\n');

    // Start agent
    console.log('🔌 Starting agent...');
    await agent.start();
    console.log('✅ Agent started\n');

    // Create a session
    console.log('📝 Creating session...');
    const session = await agent.createSession();
    console.log(`✅ Session: ${session.id}\n`);

    // Example interaction
    console.log('💬 Sending message...');
    const response = await agent.run(
        'Hello! Can you list the files in the current directory?',
        undefined, // imageDataInput
        undefined, // fileDataInput
        session.id // sessionId
    );
    console.log('📨 Agent response:');
    console.log(`   ${response}\n`);

    // Cleanup
    console.log('🛑 Stopping agent...');
    await agent.stop();
    console.log('✅ Agent stopped\n');

    console.log('✨ Example complete!');
    console.log('\nKey Takeaways:');
    console.log('  ✓ Image imported as side-effect: import "@dexto/image-local"');
    console.log('  ✓ Image specified in config: image: "@dexto/image-local"');
    console.log('  ✓ Used DextoAgent from @dexto/core');
    console.log('  ✓ Providers auto-registered (filesystem-tools, process-tools)');
    console.log('  ✓ This matches `dexto create-app` output 🎉');
}

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
