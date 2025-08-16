#!/usr/bin/env node

import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';

interface AgentTools {
    summarize: (input: string | { text: string }) => Promise<string>;
    translate: (input: string | { text: string; target_language?: string }) => Promise<string>;
    analyze: (input: string | { text: string }) => Promise<string>;
}

export class LangChainAgent {
    private llm: ChatOpenAI;
    private tools: AgentTools;

    constructor() {
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4o-mini',
            temperature: 0.7,
        });

        this.tools = {
            summarize: this.summarize.bind(this),
            translate: this.translate.bind(this),
            analyze: this.analyze.bind(this),
        };
    }

    async run(input: string): Promise<string> {
        try {
            console.error(
                `LangChain Agent received: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`
            );

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

            const content =
                typeof result.content === 'string' ? result.content : String(result.content);
            console.error(
                `LangChain Agent response: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`
            );

            return content;
        } catch (error: any) {
            console.error(`LangChain Agent error: ${error.message}`);
            return `I encountered an error: ${error.message}`;
        }
    }

    private async summarize(input: string | { text: string }): Promise<string> {
        const summaryPrompt = PromptTemplate.fromTemplate(`
            Please create a concise summary of the following text:
            
            Text: {text}
            
            Provide a clear, well-structured summary that captures the key points and main ideas.
        `);

        const chain = summaryPrompt.pipe(this.llm);
        const result = await chain.invoke({
            text: typeof input === 'string' ? input : input.text,
        });
        return result.content as string;
    }

    private async translate(
        input: string | { text: string; target_language?: string }
    ): Promise<string> {
        const translatePrompt = PromptTemplate.fromTemplate(`
            Please translate the following text:
            
            Text: {text}
            Target Language: {target_language}
            
            Provide an accurate translation that maintains the original meaning and tone.
        `);

        const chain = translatePrompt.pipe(this.llm);
        const result = await chain.invoke({
            text: typeof input === 'string' ? input : input.text,
            target_language:
                typeof input === 'string' ? 'English' : input.target_language || 'English',
        });
        return result.content as string;
    }

    private async analyze(input: string | { text: string }): Promise<string> {
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
            text: typeof input === 'string' ? input : input.text,
        });
        return result.content as string;
    }
}

// For direct testing
if (import.meta.url === `file://${process.argv[1]}`) {
    const agent = new LangChainAgent();

    console.log('LangChain Agent Test Mode');
    console.log('Type your message (or "quit" to exit):');

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (data) => {
        const input = data.toString().trim();
        if (input.toLowerCase() === 'quit') {
            process.exit(0);
        }

        try {
            const response = await agent.run(input);
            console.log('\nAgent Response:', response);
        } catch (error: any) {
            console.error('Error:', error.message);
        }

        console.log('\nType your message (or "quit" to exit):');
    });
}
