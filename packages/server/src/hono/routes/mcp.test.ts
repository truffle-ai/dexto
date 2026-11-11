import { describe, expect, it } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import { McpServerConfigSchema } from '@dexto/core';
import { createMcpRouter } from './mcp.js';

const stdioConfig = McpServerConfigSchema.parse({
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { API_TOKEN: 'stdio-secret-value', REGION: 'eu' },
});

const httpConfig = McpServerConfigSchema.parse({
    type: 'http',
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer http-secret-value' },
});

const sseConfig = McpServerConfigSchema.parse({
    type: 'sse',
    url: 'https://mcp.example.com/sse',
    headers: { 'X-Api-Key': 'sse-secret-value' },
});

function createApp() {
    const configs = { stdio: stdioConfig, http: httpConfig, sse: sseConfig };
    const agent = {
        getMcpServerConfig: (name: string) => configs[name as keyof typeof configs],
    } as unknown as DextoAgent;
    return createMcpRouter(
        async () => agent,
        async () => '/tmp/agent.yml'
    );
}

describe('GET /mcp/servers/:serverId/config', () => {
    it('masks env values but keeps their names for stdio servers', async () => {
        const response = await createApp().request('/mcp/servers/stdio/config');

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).not.toContain('stdio-secret-value');
        expect(JSON.parse(body).config.env).toEqual({
            API_TOKEN: '[REDACTED]',
            REGION: '[REDACTED]',
        });
    });

    it('masks header values but keeps their names for http servers', async () => {
        const response = await createApp().request('/mcp/servers/http/config');

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).not.toContain('http-secret-value');
        expect(JSON.parse(body).config.headers).toEqual({ Authorization: '[REDACTED]' });
    });

    it('masks header values for sse servers', async () => {
        const response = await createApp().request('/mcp/servers/sse/config');

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).not.toContain('sse-secret-value');
        expect(JSON.parse(body).config.headers).toEqual({ 'X-Api-Key': '[REDACTED]' });
    });

    it('keeps the rest of the configuration', async () => {
        const response = await createApp().request('/mcp/servers/stdio/config');

        const { config } = await response.json();
        expect(config).toMatchObject({ type: 'stdio', command: 'node', args: ['server.js'] });
    });
});
