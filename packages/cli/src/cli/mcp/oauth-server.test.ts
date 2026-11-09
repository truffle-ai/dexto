import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpCallbackServer } from './oauth-server.js';

async function freePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            probe.close(() =>
                address && typeof address === 'object'
                    ? resolve(address.port)
                    : reject(new Error('No port'))
            );
        });
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('MCP OAuth callback server', () => {
    it('listens on the loopback address only', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const listenHosts: unknown[] = [];
        const listen = net.Server.prototype.listen;
        vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function (
            this: net.Server,
            ...args: unknown[]
        ) {
            listenHosts.push(args.find((arg) => typeof arg === 'string'));
            return Reflect.apply(listen, this, args);
        });

        const port = await freePort();
        const code = createMcpCallbackServer(`http://localhost:${port}/callback`);
        await vi.waitFor(async () => {
            const response = await fetch(`http://127.0.0.1:${port}/callback?code=abc`);
            expect(response.status).toBe(200);
        });

        await expect(code).resolves.toBe('abc');
        expect(listenHosts.length).toBeGreaterThan(0);
        expect(listenHosts.every((host) => host === '127.0.0.1')).toBe(true);
    });
});
