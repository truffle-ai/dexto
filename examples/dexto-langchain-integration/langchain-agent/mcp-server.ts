#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LangChainAgent } from './agent.js';

class LangChainMCPServer {
    private server: McpServer;
    private agent: LangChainAgent;

    constructor() {
        this.server = new McpServer({
            name: 'langchain-agent',
            version: '1.0.0',
        });

        this.agent = new LangChainAgent();
        this.registerTools();
    }

    private registerTools(): void {
        this.server.registerTool(
            'chat_with_langchain_agent',
            {
                description:
                    'Chat with a helpful LangChain agent that can summarize text, translate languages, and perform sentiment analysis.',
                inputSchema: {
                    message: z
                        .string()
                        .describe(
                            'The message to send to the LangChain agent. The agent will use its own reasoning to determine which internal tools to use.'
                        ),
                },
            },
            async ({ message }: { message: string }) => {
                try {
                    console.error(`MCP Server: Forwarding message to LangChain agent`);

                    const response = await this.agent.run(message);

                    console.error(`MCP Server: Received response from LangChain agent`);

                    return {
                        content: [
                            {
                                type: 'text',
                                text: response,
                            },
                        ],
                    };
                } catch (error: any) {
                    console.error(`MCP Server error: ${error.message}`);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error communicating with LangChain agent: ${error.message}`,
                            },
                        ],
                    };
                }
            }
        );
    }

    async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('LangChain Agent MCP Server started and ready for connections');
    }
}

// Start the server
const server = new LangChainMCPServer();
server.start().catch(console.error);
