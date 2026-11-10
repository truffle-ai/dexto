import { once } from 'node:events';
import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import { createNodeServer } from './index.js';

vi.mock('@dexto/core', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('request body limit', () => {
    it('rejects an oversized POST with a typed 413 error', async () => {
        const app = new OpenAPIHono();
        app.post('/upload', async (ctx) => ctx.text(await ctx.req.text()));
        const { server } = createNodeServer(app, {
            getAgent: () => {
                throw new Error('unused');
            },
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('missing address');
        try {
            const response = await fetch(`http://127.0.0.1:${address.port}/upload`, {
                method: 'POST',
                body: 'x'.repeat(10 * 1024 * 1024 + 1),
            });
            expect(response.status).toBe(413);
            expect(await response.json()).toMatchObject({ error: 'Payload Too Large' });
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        }
    });
});
