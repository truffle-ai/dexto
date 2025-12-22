/**
 * Example 4: Starting a Dexto API Server
 *
 * This demonstrates how to spin up a full REST API server with:
 * - REST API endpoints at /api/*
 * - OpenAPI documentation at /openapi.json
 * - Health check at /health
 * - Agent-to-Agent communication via /.well-known/agent-card.json
 * - Server-Sent Events for real-time streaming
 */

// Import from core packages
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig } from '@dexto/agent-management';
import { startDextoServer } from '@dexto/server';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

async function main() {
    console.log('🚀 Example 4: Dexto Server\n');

    // Load agent configuration
    console.log('📝 Loading configuration...');
    const config = await loadAgentConfig('./agents/default.yml');
    console.log('✅ Config loaded (image: @dexto/image-local)\n');

    // Create agent
    console.log('🤖 Creating agent...');
    const agent = new DextoAgent(config, './agents/default.yml');
    console.log('✅ Agent created\n');

    // Start the server - this handles ALL the wiring!
    console.log('🌐 Starting Dexto server...');

    // Use absolute path from current working directory
    // This works with tsx since we run from the project root
    const webRoot = resolve(process.cwd(), 'app');

    // Verify the path exists
    if (!existsSync(webRoot)) {
        console.error(`❌ Error: Web root not found at ${webRoot}`);
        console.error('   Make sure the app/ directory exists in the project root');
        process.exit(1);
    }

    console.log(`📁 Serving static files from: ${webRoot}`);
    const { stop } = await startDextoServer(agent, {
        port: 3000,
        webRoot, // Serve the frontend from app/
        agentCard: {
            name: 'Example Server Agent',
            description: 'A simple example showing how to start a Dexto server with UI',
        },
    });

    console.log('\n✅ Server is running!\n');
    console.log('🌐 Open your browser:');
    console.log('  http://localhost:3000\n');
    console.log('📚 Available endpoints:');
    console.log('  • Web UI:        http://localhost:3000');
    console.log('  • REST API:      http://localhost:3000/api/*');
    console.log('  • Health Check:  http://localhost:3000/health');
    console.log('  • OpenAPI Spec:  http://localhost:3000/openapi.json');
    console.log('  • Agent Card:    http://localhost:3000/.well-known/agent-card.json\n');

    console.log('🧪 Try these commands:');
    console.log('  # 1. Create a session');
    console.log(`  curl -X POST http://localhost:3000/api/sessions \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{}'`);
    console.log();
    console.log('  # 2. Send a message (replace SESSION_ID with the id from step 1)');
    console.log(`  curl -X POST http://localhost:3000/api/message-sync \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(
        `    -d '{"content": "Hello! Tell me about yourself.", "sessionId": "SESSION_ID"}'`
    );
    console.log();
    console.log('  # Check health');
    console.log('  curl http://localhost:3000/health');
    console.log();
    console.log('  # View OpenAPI spec');
    console.log('  curl http://localhost:3000/openapi.json\n');

    console.log('💡 Key Takeaways:');
    console.log('  ✓ One function call: startDextoServer(agent, options)');
    console.log('  ✓ Full REST API with all endpoints');
    console.log('  ✓ SSE streaming support');
    console.log('  ✓ Agent-to-Agent communication');
    console.log('  ✓ No boilerplate - everything is wired automatically!\n');

    console.log('Press Ctrl+C to stop the server...\n');

    // Handle graceful shutdown
    const shutdown = async () => {
        console.log('\n🛑 Shutting down...');
        await stop();
        console.log('✅ Server stopped\n');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
