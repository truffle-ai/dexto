import process from 'node:process';
import { writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setTimeout } from 'node:timers/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [pidFile, label] = process.argv.slice(2);
writeFileSync(pidFile, String(process.pid));
const server = new Server(
    { name: 'direct-call-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        { name: 'literal--tool', inputSchema: { type: 'object' } },
        {
            name: 'invalid-output',
            inputSchema: { type: 'object' },
            outputSchema: {
                type: 'object',
                properties: { count: { type: 'integer' } },
                required: ['count'],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = request.params.arguments ?? {};
    if (typeof args.startedFile === 'string') writeFileSync(args.startedFile, 'started');
    if (args.delay) {
        try {
            await setTimeout(Number(args.delay), undefined, { signal: extra.signal });
        } catch (error) {
            if (typeof args.cancelledFile === 'string')
                writeFileSync(args.cancelledFile, 'cancelled');
            throw error;
        }
    }
    return {
        ...(args.error ? { isError: true } : {}),
        content: [{ type: 'text', text: label }],
        structuredContent: { name: request.params.name, arguments: request.params.arguments },
        _meta: { fixture: label },
        extension: { preserved: true },
    };
});
await server.connect(new StdioServerTransport());
