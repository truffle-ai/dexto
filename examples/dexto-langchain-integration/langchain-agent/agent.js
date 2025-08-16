#!/usr/bin/env node

/**
 * Self-Contained LangChain Agent Example
 * 
 * This represents how someone would typically build an agent using LangChain.
 * The agent has its own internal tools, reasoning, and orchestration capabilities.
 * It's designed to be a complete, standalone agent that can be wrapped in an MCP server.
 */

import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';

class LangChainAgent {
    constructor() {
        // Initialize the LLM
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4o-mini',
            temperature: 0.7,
        });

        // Define the agent's tools
        this.tools = {
            calculate: this.calculate.bind(this),
            analyze: this.analyze.bind(this),
            search: this.search.bind(this),
            create: this.create.bind(this),
        };
    }

    /**
     * Main entry point for the agent
     * This is how someone would typically interact with a LangChain agent
     */
    async run(input) {
        try {
            console.error(`LangChain Agent received: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);
            
            // Simple prompt-based approach
            const prompt = PromptTemplate.fromTemplate(`
                You are a helpful AI agent with access to various tools. You can:
                - calculate: Perform mathematical calculations
                - analyze: Analyze text for sentiment, topics, and insights
                - search: Search for information (simulated)
                - create: Generate creative content

                User input: {user_input}

                Think through what the user needs and respond appropriately. If you need to perform a calculation, analysis, search, or create content, let me know and I'll help you with that.

                Please provide a helpful response to the user's request.
            `);

            const chain = prompt.pipe(this.llm);
            const result = await chain.invoke({ user_input: input });

            console.error(`LangChain Agent response: ${result.content.substring(0, 100)}${result.content.length > 100 ? '...' : ''}`);
            
            return result.content;
        } catch (error) {
            console.error(`LangChain Agent error: ${error.message}`);
            return `I encountered an error: ${error.message}`;
        }
    }

    /**
     * Tool: Mathematical calculations
     */
    async calculate(input) {
        const calculationPrompt = PromptTemplate.fromTemplate(`
            You are a mathematical assistant. Please evaluate the following expression:
            {expression}
            
            Provide the result and a brief explanation of your calculation.
        `);

        const chain = calculationPrompt.pipe(this.llm);
        const result = await chain.invoke({ expression: input });
        return result.content;
    }

    /**
     * Tool: Text analysis
     */
    async analyze(input) {
        const analysisPrompt = PromptTemplate.fromTemplate(`
            Please analyze the following text:
            
            Text: {text}
            Analysis Type: {analysis_type}
            
            For sentiment analysis: Provide sentiment (positive/negative/neutral) and confidence level
            For topics: Identify main topics and themes
            For summary: Provide a concise summary
            For full analysis: Provide sentiment, topics, summary, and key insights
        `);

        const chain = analysisPrompt.pipe(this.llm);
        const result = await chain.invoke({
            text: input.text || input,
            analysis_type: input.analysis_type || 'full',
        });
        return result.content;
    }

    /**
     * Tool: Information search (simulated)
     */
    async search(input) {
        const searchPrompt = PromptTemplate.fromTemplate(`
            Simulate a search for the following query:
            {query}
            
            Provide a comprehensive response as if you searched the web and found relevant information.
            Include multiple sources and perspectives.
        `);

        const chain = searchPrompt.pipe(this.llm);
        const result = await chain.invoke({ query: input });
        return result.content;
    }

    /**
     * Tool: Creative content generation
     */
    async create(input) {
        const createPrompt = PromptTemplate.fromTemplate(`
            Create creative content based on the following request:
            {request}
            
            Generate engaging, original content that matches the request.
            Be creative and imaginative in your response.
        `);

        const chain = createPrompt.pipe(this.llm);
        const result = await chain.invoke({ request: input });
        return result.content;
    }
}

// For direct testing
if (import.meta.url === `file://${process.argv[1]}`) {
    const agent = new LangChainAgent();
    
    console.log('LangChain Agent Test Mode');
    console.log('Type your message (or "quit" to exit):');
    
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (data) => {
        const input = data.trim();
        if (input.toLowerCase() === 'quit') {
            process.exit(0);
        }
        
        try {
            const response = await agent.run(input);
            console.log('\nAgent Response:', response);
        } catch (error) {
            console.error('Error:', error.message);
        }
        
        console.log('\nType your message (or "quit" to exit):');
    });
}

export { LangChainAgent }; 