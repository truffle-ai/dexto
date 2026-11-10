import { once } from 'node:events';
import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import { createNodeServer } from './index.js';

vi.mock('@dexto/core', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('request body limit', () => {
    it.each([
        { size: 34 * 1024 * 1024, status: 200 },
        { size: 64 * 1024 * 1024 + 1, status: 413 },
    ])('handles a $size byte POST', async ({ size, status }) => {
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
                body: 'x'.repeat(size),
            });
            expect(response.status).toBe(status);
            if (status === 413)
                expect(await response.json()).toMatchObject({
                    error: 'Payload Too Large',
                    message: 'Request body exceeds 64 MiB.',
                });
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        }
    });
});
