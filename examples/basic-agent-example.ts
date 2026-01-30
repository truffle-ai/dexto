/**
 * Basic Dexto Agent SDK Example
 *
 * This example demonstrates the simplest way to use the Dexto Agent SDK
 * to create an AI agent and have a conversation.
 *
 * Run with: npx tsx examples/basic-agent-example.ts
 */
import 'dotenv/config';
import { DextoAgent } from '@dexto/core';

// Create agent with minimal configuration
const agent = new DextoAgent({
    systemPrompt: 'You are a helpful AI assistant.',
    llm: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: process.env.OPENAI_API_KEY || '',
    },
});

await agent.start();

// Create a session for the conversation
const session = await agent.createSession();

// Use generate() for simple request/response
console.log('Asking a question...\n');
const response = await agent.generate('What is TypeScript and why is it useful?', session.id);
console.log(response.content);
console.log(`\n(Used ${response.usage.totalTokens} tokens)\n`);

// Conversations maintain context within a session
console.log('---\nAsking for a haiku...\n');
const haiku = await agent.generate('Write a haiku about TypeScript', session.id);
console.log(haiku.content);

console.log('\n---\nAsking to make it funnier...\n');
const funnier = await agent.generate('Make it funnier', session.id);
console.log(funnier.content);

await agent.stop();
console.log('\n✅ Done!');
