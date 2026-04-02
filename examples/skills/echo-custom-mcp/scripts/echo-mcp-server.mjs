#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
    {
        name: 'skill-echo-demo',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'echo_message',
            description: 'Echo a test message from the skill-bundled MCP server.',
            inputSchema: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: 'Message to echo back',
                    },
                },
                required: ['message'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'echo_message') {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const message =
        typeof request.params.arguments?.message === 'string' ? request.params.arguments.message : '';

    return {
        content: [
            {
                type: 'text',
                text: `Echo from skill MCP: ${message}`,
            },
        ],
    };
});

const transport = new StdioServerTransport();
await server.connect(transport);
