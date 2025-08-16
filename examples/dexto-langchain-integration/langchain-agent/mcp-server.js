#!/usr/bin/env node

/**
 * MCP Server for LangChain Agent
 * 
 * This demonstrates how to wrap a complete, self-contained LangChain agent
 * in an MCP server with a single tool entry point. The agent handles its own
 * internal orchestration and tool selection.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LangChainAgent } from './agent.js';

class LangChainMCPServer {
    constructor() {
        this.server = new McpServer({
            name: 'langchain-agent',
            version: '1.0.0'
        });
        
        // Initialize the LangChain agent
        this.agent = new LangChainAgent();
        
        this.registerTools();
    }

    registerTools() {
        // Single tool that exposes the entire LangChain agent
        this.server.registerTool(
            'chat_with_langchain_agent',
            {
                description: 'Chat with a helpful LangChain agent that can summarize text, translate languages, and perform sentiment analysis.',
                inputSchema: {
                    message: z.string().describe('The message to send to the LangChain agent. The agent will use its own reasoning to determine which internal tools to use.')
                }
            },
            async ({ message }) => {
                try {
                    console.error(`MCP Server: Forwarding message to LangChain agent`);
                    
                    // Delegate to the LangChain agent's main entry point
                    const response = await this.agent.run(message);
                    
                    console.error(`MCP Server: Received response from LangChain agent`);
                    
                    return { 
                        content: [{ 
                            type: 'text', 
                            text: response 
                        }] 
                    };
                } catch (error) {
                    console.error(`MCP Server error: ${error.message}`);
                    return { 
                        content: [{ 
                            type: 'text', 
                            text: `Error communicating with LangChain agent: ${error.message}` 
                        }] 
                    };
                }
            }
        );
    }

    async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('LangChain Agent MCP Server started and ready for connections');
    }
}

// Start the server
const server = new LangChainMCPServer();
server.start().catch(console.error); 