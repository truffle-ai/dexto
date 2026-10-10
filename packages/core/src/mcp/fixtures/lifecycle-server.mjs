import process from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const [pidFile, modeArgument, modeFile, releaseFile] = process.argv.slice(2);
const mode = modeArgument === 'from-file' ? readFileSync(modeFile, 'utf8') : modeArgument;
writeFileSync(pidFile, String(process.pid));

if (mode === 'reject-handshake') {
    const input = createInterface({ input: process.stdin });
    input.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') {
            process.stdout.write(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: request.id,
                    error: { code: -32603, message: 'fixture handshake rejected' },
                }) + '\n'
            );
        }
    });
    input.on('close', () => process.exit(0));
} else {
    if (mode === 'wait-for-file') {
        while (!existsSync(releaseFile)) await setTimeout(10);
    }
    const server = new McpServer({ name: 'lifecycle-fixture', version: '1.0.0' });
    server.registerTool('ping', { inputSchema: {} }, async () => ({
        content: [{ type: 'text', text: 'pong' }],
    }));
    await server.connect(new StdioServerTransport());
}
