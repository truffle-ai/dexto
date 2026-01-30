/**
 * AgentManager Example
 *
 * This example demonstrates how to use AgentManager to:
 * - Load agents from a registry file
 * - List available agents with metadata
 * - Create and use agents by ID
 *
 * Run with: npx tsx examples/agent-manager-example/main.ts
 */
import 'dotenv/config';
import path from 'path';
import { AgentManager } from '@dexto/agent-management';

const registryPath = path.join(import.meta.dirname, 'agents/registry.json');

async function main() {
    console.log('=== AgentManager Example ===\n');

    // Initialize the manager with a registry file
    const manager = new AgentManager(registryPath);
    await manager.loadRegistry();

    // List all available agents
    console.log('Available agents:');
    const agents = manager.listAgents();
    for (const agent of agents) {
        console.log(`  - ${agent.name} (${agent.id})`);
        console.log(`    ${agent.description}`);
        if (agent.tags?.length) {
            console.log(`    Tags: ${agent.tags.join(', ')}`);
        }
        console.log();
    }

    // Check if a specific agent exists
    const agentId = 'coding-agent';
    if (!manager.hasAgent(agentId)) {
        console.error(`Agent '${agentId}' not found in registry`);
        process.exit(1);
    }

    // Load and use the coding agent
    console.log(`Loading '${agentId}'...`);
    const codingAgent = await manager.loadAgent(agentId);
    await codingAgent.start();

    const session = await codingAgent.createSession();

    console.log('\nAsking the coding agent a question...\n');
    const response = await codingAgent.generate(
        'Write a TypeScript function that checks if a string is a palindrome.',
        session.id
    );

    console.log('Response:');
    console.log(response.content);
    console.log(`\n(Used ${response.usage.totalTokens} tokens)`);

    await codingAgent.stop();

    // Demonstrate switching to a different agent
    console.log('\n--- Switching to support agent ---\n');

    const supportAgent = await manager.loadAgent('support-agent');
    await supportAgent.start();

    const supportSession = await supportAgent.createSession();
    const supportResponse = await supportAgent.generate(
        "Hi, I'm having trouble logging into my account. Can you help?",
        supportSession.id
    );

    console.log('Response:');
    console.log(supportResponse.content);

    await supportAgent.stop();

    console.log('\n✅ Done!');
}

main().catch(console.error);
