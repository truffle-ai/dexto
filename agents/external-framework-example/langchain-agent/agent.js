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
import { RunnableSequence } from '@langchain/core/runnables';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';

class LangChainAgent {
    constructor() {
        // Initialize the LLM
        this.llm = new ChatOpenAI({
            modelName: 'gpt-3.5-turbo',
            temperature: 0.7,
        });

        // Define the agent's tools
        this.tools = {
            calculate: this.calculate.bind(this),
            analyze: this.analyze.bind(this),
            search: this.search.bind(this),
            create: this.create.bind(this),
        };

        // Create the main agent chain
        this.agentChain = this.createAgentChain();
    }

    /**
     * Main entry point for the agent
     * This is how someone would typically interact with a LangChain agent
     */
    async run(input) {
        try {
            console.error(`LangChain Agent received: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);
            
            const result = await this.agentChain.invoke({
                user_input: input,
                available_tools: Object.keys(this.tools),
            });

            console.error(`LangChain Agent response: ${result.response.substring(0, 100)}${result.response.length > 100 ? '...' : ''}`);
            
            return result.response;
        } catch (error) {
            console.error(`LangChain Agent error: ${error.message}`);
            return `I encountered an error: ${error.message}`;
        }
    }

    /**
     * Create the main agent chain with reasoning and tool selection
     */
    createAgentChain() {
        // Output parser for structured responses
        const outputParser = StructuredOutputParser.fromZodSchema(
            z.object({
                reasoning: z.string().describe("The agent's reasoning about what to do"),
                tool_to_use: z.string().optional().describe("The tool to use, if any"),
                tool_input: z.any().optional().describe("Input for the tool"),
                response: z.string().describe("The final response to the user"),
            })
        );

        // Main agent prompt
        const agentPrompt = PromptTemplate.fromTemplate(`
            You are a helpful AI agent with access to various tools. You can:
            - calculate: Perform mathematical calculations
            - analyze: Analyze text for sentiment, topics, and insights
            - search: Search for information (simulated)
            - create: Generate creative content

            Available tools: {available_tools}

            User input: {user_input}

            Think through what the user needs and decide whether to use a tool or respond directly.
            If you need to use a tool, specify which one and what input to provide.
            Always provide clear reasoning for your decisions.

            {format_instructions}
        `);

        // Create the chain
        const chain = RunnableSequence.from([
            {
                available_tools: () => Object.keys(this.tools),
                user_input: (input) => input.user_input,
                format_instructions: outputParser.getFormatInstructions(),
            },
            agentPrompt,
            this.llm,
            outputParser,
        ]);

        // Wrap with tool execution logic
        return RunnableSequence.from([
            chain,
            async (result) => {
                if (result.tool_to_use && this.tools[result.tool_to_use]) {
                    try {
                        const toolResult = await this.tools[result.tool_to_use](result.tool_input);
                        return {
                            ...result,
                            response: `${result.response}\n\nTool Result: ${toolResult}`,
                        };
                    } catch (error) {
                        return {
                            ...result,
                            response: `${result.response}\n\nTool Error: ${error.message}`,
                        };
                    }
                }
                return result;
            },
        ]);
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

        const chain = RunnableSequence.from([
            calculationPrompt,
            this.llm,
        ]);

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

        const chain = RunnableSequence.from([
            analysisPrompt,
            this.llm,
        ]);

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

        const chain = RunnableSequence.from([
            searchPrompt,
            this.llm,
        ]);

        const result = await chain.invoke({ query: input });
        return result.content;
    }

    /**
     * Tool: Creative content generation
     */
    async create(input) {
        const creativePrompt = PromptTemplate.fromTemplate(`
            Create {style} content based on the following prompt:
            
            Prompt: {prompt}
            Style: {style}
            Length: {length}
            
            Please create engaging, creative content that matches the requested style and length.
        `);

        const chain = RunnableSequence.from([
            creativePrompt,
            this.llm,
        ]);

        const result = await chain.invoke({
            prompt: input.prompt || input,
            style: input.style || 'story',
            length: input.length || 'medium',
        });
        return result.content;
    }
}

// Export for use in MCP server
export { LangChainAgent };

// If run directly, create a simple CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
    const agent = new LangChainAgent();
    
    console.error('LangChain Agent CLI started. Type "exit" to quit.');
    console.error('Enter your request:');
    
    process.stdin.on('data', async (data) => {
        const input = data.toString().trim();
        
        if (input.toLowerCase() === 'exit') {
            process.exit(0);
        }
        
        if (input) {
            const response = await agent.run(input);
            console.log(response);
            console.error('\nEnter your next request:');
        }
    });
} 