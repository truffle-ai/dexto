/**
 * Example: Using @dexto/image-local Base Image
 *
 * This demonstrates the power of base images:
 * - No manual provider registration
 * - No boilerplate
 * - Just import, configure, and use
 */

// Import from local harness implementation (Example 0)
import { createAgent, imageMetadata } from '../../00-harness-implementation/dist/index.js';
import { loadAgentConfig } from '@dexto/agent-management';

async function main() {
    console.log('🚀 Dexto Base Image Example\n');

    // Show what image we're using
    console.log('Using Base Image:');
    console.log(`  Name:        ${imageMetadata.name}`);
    console.log(`  Version:     ${imageMetadata.version}`);
    console.log(`  Target:      ${imageMetadata.target}`);
    console.log(`  Built:       ${imageMetadata.builtAt}`);
    console.log(`  Core:        v${imageMetadata.coreVersion}`);
    console.log(`  Constraints: ${imageMetadata.constraints.join(', ')}\n`);

    // Load agent configuration
    console.log('📝 Loading agent configuration...');
    const config = await loadAgentConfig('./agents/default.yml');
    console.log('✅ Config loaded\n');

    // Create agent - providers already registered by image!
    console.log('🤖 Creating agent...');
    const agent = createAgent(config, './agents/default.yml');

    console.log('✅ Agent created (providers already registered by image)');
    console.log('   No manual provider registration needed!\n');

    // Start agent
    console.log('🔌 Starting agent...');
    await agent.start();
    console.log('✅ Agent started\n');

    // Create a session (sessionId will be auto-generated)
    console.log('📝 Creating session...');
    const session = await agent.createSession();
    console.log(`✅ Session created: ${session.id}\n`);

    // Run a simple test
    console.log('💬 Testing agent...');
    const response = await agent.run(
        'Hello! Can you tell me about yourself in one sentence?',
        undefined, // imageDataInput
        undefined, // fileDataInput
        session.id // sessionId (4th parameter)
    );

    console.log('📨 Agent response:');
    console.log(`   ${response}\n`);

    // Cleanup
    console.log('🛑 Stopping agent...');
    await agent.stop();
    console.log('✅ Agent stopped\n');

    console.log('✨ Example complete!');
    console.log('\nKey Takeaway:');
    console.log('  - Imported @dexto/image-local');
    console.log('  - Called createAgent() - providers already registered!');
    console.log('  - No boilerplate, no manual setup');
    console.log('  - This is the power of base images 🎉');
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
