#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
    {
        name: 'memory-demo-server',
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
            name: 'create_entities',
            description: 'Create entities in an in-memory graph (demo)',
            inputSchema: {
                type: 'object',
                properties: {
                    entities: {
                        type: 'array',
                        description: 'Entities to create',
                        items: {
                            type: 'object',
                            additionalProperties: true,
                        },
                    },
                },
                required: ['entities'],
            },
        },
        {
            name: 'read_graph',
            description: 'Read the in-memory graph (demo)',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    return {
        content: [
            {
                type: 'text',
                text:
                    name === 'read_graph'
                        ? JSON.stringify({ ok: true, graph: {} }, null, 2)
                        : JSON.stringify({ ok: true, name, args }, null, 2),
            },
        ],
    };
});

try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
} catch (error) {
    console.error('Failed to start memory-demo-server:', error);
    process.exit(1);
}
