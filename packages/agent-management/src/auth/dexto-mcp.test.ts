import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type OAuthLogin, writeLogin } from './dexto-accounts.js';
import type { DextoGatewayOptions } from './dexto-gateway.js';
import {
    DEXTO_MCP_SERVER_NAME,
    dextoMcpAuthProvider,
    dextoMcpServer,
    withDextoMcpAuth,
    withDextoMcpServer,
} from './dexto-mcp.js';

function signedIn(overrides: Partial<OAuthLogin> = {}): OAuthLogin {
    return {
        kind: 'oauth',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: 'https://app.dexto.ai',
        apiBaseUrl: 'https://api.dexto.ai',
        resource: 'https://app.dexto.ai/mcp',
        tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        scopes: ['cloud:read', 'drive:read'],
        savedAt: '2026-10-31T00:00:00.000Z',
        signedInAs: null,
        cloudProject: null,
        ...overrides,
    };
}

describe('the Dexto MCP in local sessions', () => {
    let dir: string;
    let options: DextoGatewayOptions;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-mcp-')), 'accounts');
        options = {
            dir,
            environment: {},
            apiBaseUrl: 'https://api.dexto.ai',
            fetch: globalThis.fetch,
            refresh: async (login) => ({
                ...login,
                accessToken: 'access-2',
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            }),
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it("is the sign-in's MCP resource, connected leniently so a cloud outage keeps the turn local", async () => {
        await writeLogin(dir, 'default', signedIn());

        expect(DEXTO_MCP_SERVER_NAME).toBe('dexto');
        await expect(dextoMcpServer(options)).resolves.toEqual({
            type: 'http',
            url: 'https://app.dexto.ai/mcp',
            connectionMode: 'lenient',
        });
    });

    it('is absent when signed out, or with only an API key', async () => {
        await expect(dextoMcpServer(options)).resolves.toBeNull();

        await writeLogin(dir, 'default', {
            kind: 'api_key',
            apiKey: 'dxt_key',
            apiBaseUrl: 'https://api.dexto.ai',
            savedAt: '2026-10-31T00:00:00.000Z',
        });
        await expect(dextoMcpServer(options)).resolves.toBeNull();
    });

    it("authorizes with the sign-in's token, refreshed when expiring, and never registers", async () => {
        await writeLogin(dir, 'default', signedIn({ expiresAt: new Date().toISOString() }));
        const provider = dextoMcpAuthProvider(options);

        await expect(provider.tokens()).resolves.toEqual({
            access_token: 'access-2',
            token_type: 'Bearer',
        });
        await expect(provider.clientInformation()).resolves.toEqual({ client_id: 'dexto-cli' });
    });

    it('says to sign in again instead of opening a browser of its own', async () => {
        await writeLogin(dir, 'default', signedIn());
        const provider = dextoMcpAuthProvider(options);

        await expect(
            provider.redirectToAuthorization(new URL('https://app.dexto.ai/api/oauth/authorize'))
        ).rejects.toThrow(
            'The Dexto sign-in expired or lacks a permission this tool needs. Run dexto login, or dexto login --scope <permission>.'
        );
    });

    it("adds the server, but never over the person's own server named dexto", () => {
        const server = {
            type: 'http' as const,
            url: 'https://app.dexto.ai/mcp',
            connectionMode: 'lenient' as const,
        };
        const own = { type: 'stdio' as const, command: 'my-dexto' };

        expect(withDextoMcpServer(undefined, server)).toEqual({ dexto: server });
        expect(withDextoMcpServer({ fs: own }, server)).toEqual({ fs: own, dexto: server });
        expect(withDextoMcpServer({ dexto: own }, server)).toEqual({ dexto: own });
        expect(withDextoMcpServer({ fs: own }, null)).toEqual({ fs: own });
    });

    it('authorizes only the dexto server with the sign-in, and others as before', () => {
        const other = { tokens: () => undefined } as never;
        const factory = withDextoMcpAuth(() => other, options);
        const config = { type: 'http', url: 'https://x' } as never;

        expect(factory('github', config)).toBe(other);
        expect(factory('dexto', config)).not.toBe(other);
        expect(withDextoMcpAuth(null, options)('github', config)).toBeUndefined();
    });
});
