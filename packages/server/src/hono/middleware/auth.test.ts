import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import {
    DEFAULT_SERVER_HOSTNAME,
    assertNetworkBindAllowed,
    createHttpAuthorization,
    isLoopbackHost,
    resolveServerHostname,
} from './auth.js';
import { createNodeServer } from '../node/index.js';
import { startDextoServer } from '../start-server.js';

afterEach(() => {
    vi.unstubAllEnvs();
});

function clearAuthEnv() {
    vi.stubEnv('DEXTO_SERVER_API_KEY', '');
    vi.stubEnv('DEXTO_SERVER_REQUIRE_AUTH', '');
    vi.stubEnv('DEXTO_SERVER_HOST', '');
    vi.stubEnv('NODE_ENV', 'development');
}

describe('bind host helpers', () => {
    it('treats only literal loopback addresses as loopback', () => {
        expect(isLoopbackHost('127.0.0.1')).toBe(true);
        expect(isLoopbackHost('::1')).toBe(true);
        expect(isLoopbackHost('[::1]')).toBe(true);
        expect(isLoopbackHost('0.0.0.0')).toBe(false);
        expect(isLoopbackHost('::')).toBe(false);
        expect(isLoopbackHost('localhost')).toBe(false);
        expect(isLoopbackHost('192.168.1.10')).toBe(false);
    });

    it('defaults to loopback, then DEXTO_SERVER_HOST, then an explicit host', () => {
        clearAuthEnv();
        expect(resolveServerHostname()).toBe(DEFAULT_SERVER_HOSTNAME);
        expect(DEFAULT_SERVER_HOSTNAME).toBe('127.0.0.1');
        vi.stubEnv('DEXTO_SERVER_HOST', '0.0.0.0');
        expect(resolveServerHostname()).toBe('0.0.0.0');
        expect(resolveServerHostname('::1')).toBe('::1');
    });

    it('refuses a non-loopback bind without a key and allows it with one', () => {
        clearAuthEnv();
        expect(() => assertNetworkBindAllowed('127.0.0.1')).not.toThrow();
        expect(() => assertNetworkBindAllowed('0.0.0.0')).toThrow(/DEXTO_SERVER_API_KEY/);
        expect(() => assertNetworkBindAllowed('localhost')).toThrow(/DEXTO_SERVER_API_KEY/);
        vi.stubEnv('DEXTO_SERVER_API_KEY', '   ');
        expect(() => assertNetworkBindAllowed('0.0.0.0')).toThrow(/DEXTO_SERVER_API_KEY/);
        vi.stubEnv('DEXTO_SERVER_API_KEY', 'synthetic-key');
        expect(() => assertNetworkBindAllowed('0.0.0.0')).not.toThrow();
    });

    it('allows a non-loopback bind when built-in auth is explicitly disabled', () => {
        clearAuthEnv();
        expect(() => assertNetworkBindAllowed('0.0.0.0', { authDisabled: true })).not.toThrow();
    });
});

describe('createHttpAuthorization', () => {
    it('requires the bearer key whenever one is configured', () => {
        clearAuthEnv();
        vi.stubEnv('DEXTO_SERVER_API_KEY', 'synthetic-key');
        const authorize = createHttpAuthorization();
        expect(authorize(undefined)).toMatchObject({ allowed: false, status: 401 });
        expect(authorize('Bearer wrong')).toMatchObject({ allowed: false, status: 401 });
        expect(authorize('Bearer synthetic-key')).toEqual({ allowed: true });
    });

    it('allows requests without a key in development', () => {
        clearAuthEnv();
        expect(createHttpAuthorization()(undefined)).toEqual({ allowed: true });
    });

    it('fails closed in production without a key', () => {
        clearAuthEnv();
        vi.stubEnv('NODE_ENV', 'production');
        expect(createHttpAuthorization()(undefined)).toMatchObject({
            allowed: false,
            status: 500,
        });
    });
});

describe('createNodeServer bind policy', () => {
    const getAgent = () => {
        throw new Error('agent not needed');
    };

    async function listenAndClose(server: ReturnType<typeof createNodeServer>['server']) {
        if (!server.listening) await once(server, 'listening');
        const address = server.address() as AddressInfo;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return address;
    }

    it('binds to loopback by default', async () => {
        clearAuthEnv();
        const { server } = createNodeServer(new OpenAPIHono(), { getAgent, port: 0 });
        expect((await listenAndClose(server)).address).toBe('127.0.0.1');
    });

    it('refuses a non-loopback hostname without a key', () => {
        clearAuthEnv();
        expect(() =>
            createNodeServer(new OpenAPIHono(), { getAgent, port: 0, hostname: '0.0.0.0' })
        ).toThrow(/DEXTO_SERVER_API_KEY/);
    });

    it('refuses DEXTO_SERVER_HOST=0.0.0.0 without a key', () => {
        clearAuthEnv();
        vi.stubEnv('DEXTO_SERVER_HOST', '0.0.0.0');
        expect(() => createNodeServer(new OpenAPIHono(), { getAgent, port: 0 })).toThrow(
            /DEXTO_SERVER_API_KEY/
        );
    });

    it('binds a non-loopback hostname when a key is configured', async () => {
        clearAuthEnv();
        vi.stubEnv('DEXTO_SERVER_API_KEY', 'synthetic-key');
        const { server } = createNodeServer(new OpenAPIHono(), {
            getAgent,
            port: 0,
            hostname: '0.0.0.0',
        });
        expect((await listenAndClose(server)).address).toBe('0.0.0.0');
    });

    it('binds a non-loopback hostname for apps with external auth', async () => {
        clearAuthEnv();
        const app = Object.assign(new OpenAPIHono(), { authDisabled: true });
        const { server } = createNodeServer(app, { getAgent, port: 0, hostname: '0.0.0.0' });
        expect((await listenAndClose(server)).address).toBe('0.0.0.0');
    });
});

describe('startDextoServer bind policy', () => {
    it('fails before touching the agent when a non-loopback host has no key', async () => {
        clearAuthEnv();
        const agent = new Proxy(
            {},
            {
                get() {
                    throw new Error('agent must not be used');
                },
            }
        ) as unknown as DextoAgent;
        await expect(startDextoServer(agent, { port: 0, hostname: '0.0.0.0' })).rejects.toThrow(
            /DEXTO_SERVER_API_KEY/
        );
    });
});
