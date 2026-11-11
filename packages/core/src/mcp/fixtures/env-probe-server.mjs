import process from 'node:process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
    { name: 'env-probe-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'read_env', inputSchema: { type: 'object' } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const names = request.params.arguments?.names ?? [];
    const seen = {};
    for (const name of names) seen[name] = process.env[name] ?? null;
    return { content: [{ type: 'text', text: JSON.stringify(seen) }] };
});
await server.connect(new StdioServerTransport());
