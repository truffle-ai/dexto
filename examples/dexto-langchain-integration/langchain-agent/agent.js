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

class LangChainAgent {
    constructor() {
        // Initialize the LLM
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4o-mini',
            temperature: 0.7,
        });

        // Define the agent's tools
        this.tools = {
            summarize: this.summarize.bind(this),
            translate: this.translate.bind(this),
            analyze: this.analyze.bind(this),
        };
    }

    /**
     * Main entry point for the agent
     * This is how someone would typically interact with a LangChain agent
     */
    async run(input) {
        try {
            console.error(`LangChain Agent received: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);
            
            // Simple prompt that describes the agent's core capabilities
            const prompt = PromptTemplate.fromTemplate(`
                You are a helpful AI assistant with three core capabilities:

                **Core Tools:**
                - summarize: Create concise summaries of text, articles, or documents
                - translate: Translate text between different languages
                - analyze: Perform sentiment analysis on text to understand emotions and tone

                User input: {user_input}

                Based on the user's request, determine which tool would be most helpful:
                - summarize: For creating summaries of text, articles, or documents
                - translate: For translating text between languages
                - analyze: For performing sentiment analysis on text to understand emotions and tone

                Provide a helpful response that addresses the user's needs.
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
     * Tool: Text summarization
     */
    async summarize(input) {
        const summaryPrompt = PromptTemplate.fromTemplate(`
            Please create a concise summary of the following text:
            
            Text: {text}
            
            Provide a clear, well-structured summary that captures the key points and main ideas.
        `);

        const chain = summaryPrompt.pipe(this.llm);
        const result = await chain.invoke({
            text: input.text || input
        });
        return result.content;
    }

    /**
     * Tool: Text translation
     */
    async translate(input) {
        const translatePrompt = PromptTemplate.fromTemplate(`
            Please translate the following text:
            
            Text: {text}
            Target Language: {target_language}
            
            Provide an accurate translation that maintains the original meaning and tone.
        `);

        const chain = translatePrompt.pipe(this.llm);
        const result = await chain.invoke({
            text: input.text || input,
            target_language: input.target_language || 'English'
        });
        return result.content;
    }

    /**
     * Tool: Sentiment analysis
     */
    async analyze(input) {
        const analyzePrompt = PromptTemplate.fromTemplate(`
            Please perform sentiment analysis on the following text:
            
            Text: {text}
            
            Provide a comprehensive sentiment analysis covering:
            1. **Overall Sentiment**: Positive, Negative, or Neutral
            2. **Sentiment Score**: Rate from 1-10 (1=very negative, 10=very positive)
            3. **Key Emotions**: Identify specific emotions present (e.g., joy, anger, sadness, excitement)
            4. **Confidence Level**: How confident are you in this analysis?
            5. **Key Phrases**: Highlight specific phrases that influenced the sentiment
            6. **Context**: Any contextual factors that might affect interpretation
            
            Be specific and provide clear reasoning for your analysis.
        `);

        const chain = analyzePrompt.pipe(this.llm);
        const result = await chain.invoke({
            text: input.text || input
        });
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