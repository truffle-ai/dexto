import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
    loadLlmAuthProfilesStore,
    setDefaultLlmAuthProfile,
    upsertLlmAuthProfile,
} from './llm-profiles.js';
import { createDefaultLlmAuthResolver } from './runtime-auth-resolver.js';

describe('llm runtime auth resolver', () => {
    let tempHomeDir: string;
    let previousHome: string | undefined;
    let originalFetch: typeof fetch | undefined;
    let previousMiniMaxClientId: string | undefined;

    beforeEach(async () => {
        tempHomeDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-llm-auth-resolver-test-'));
        previousHome = process.env.HOME;
        process.env.HOME = tempHomeDir;
        originalFetch = globalThis.fetch;
        previousMiniMaxClientId = process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID;
    });

    afterEach(async () => {
        if (originalFetch) {
            globalThis.fetch = originalFetch;
        }
        process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID = previousMiniMaxClientId;
        process.env.HOME = previousHome;
        await fs.rm(tempHomeDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns minimax oauth runtime overrides (x-api-key + baseURL normalization)', async () => {
        await upsertLlmAuthProfile({
            profileId: 'minimax:portal_oauth_cn',
            providerId: 'minimax',
            methodId: 'portal_oauth_cn',
            credential: {
                type: 'oauth',
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() + 60_000,
                metadata: {
                    region: 'cn',
                    resourceUrl: 'https://api.minimaxi.com/anthropic',
                },
            },
        });
        await setDefaultLlmAuthProfile({
            providerId: 'minimax',
            profileId: 'minimax:portal_oauth_cn',
        });

        const resolver = createDefaultLlmAuthResolver();
        const runtime = resolver.resolveRuntimeAuth({ provider: 'minimax', model: 'MiniMax-M2.1' });
        expect(runtime?.apiKey).toBe('dexto-oauth-dummy-key');
        expect(runtime?.baseURL).toBe('https://api.minimaxi.com/anthropic/v1');
        expect(typeof runtime?.fetch).toBe('function');

        const calls: Array<{ url: string; headers: globalThis.Headers }> = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                input instanceof URL
                    ? input.toString()
                    : typeof input === 'string'
                      ? input
                      : input.url;
            calls.push({ url, headers: new globalThis.Headers(init?.headers) });
            return new Response('ok', { status: 200 });
        }) satisfies typeof fetch;

        await runtime!.fetch!('https://example.com', {
            headers: {
                'x-api-key': 'placeholder',
                Authorization: 'Bearer placeholder',
            },
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]!.headers.get('x-api-key')).toBe('access-token');
        expect(calls[0]!.headers.get('authorization')).toBe(null);
    });

    it('refreshes minimax oauth tokens when expired', async () => {
        process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID = 'client-id';

        await upsertLlmAuthProfile({
            profileId: 'minimax:portal_oauth_global',
            providerId: 'minimax',
            methodId: 'portal_oauth_global',
            credential: {
                type: 'oauth',
                accessToken: 'stale-access',
                refreshToken: 'stale-refresh',
                expiresAt: Date.now() - 1,
                metadata: { region: 'global' },
            },
        });
        await setDefaultLlmAuthProfile({
            providerId: 'minimax',
            profileId: 'minimax:portal_oauth_global',
        });

        const resolver = createDefaultLlmAuthResolver();
        const runtime = resolver.resolveRuntimeAuth({ provider: 'minimax', model: 'MiniMax-M2.1' });
        expect(runtime?.apiKey).toBe('dexto-oauth-dummy-key');
        expect(typeof runtime?.fetch).toBe('function');

        const calls: Array<{ url: string; headers: globalThis.Headers; body?: string }> = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                input instanceof URL
                    ? input.toString()
                    : typeof input === 'string'
                      ? input
                      : input.url;
            const body = init?.body?.toString();
            calls.push({
                url,
                headers: new globalThis.Headers(init?.headers),
                ...(body !== undefined ? { body } : {}),
            });

            if (url === 'https://api.minimax.io/oauth/token') {
                return new Response(
                    JSON.stringify({
                        status: 'success',
                        access_token: 'fresh-access',
                        refresh_token: 'fresh-refresh',
                        expired_in: 3600,
                    }),
                    { status: 200 }
                );
            }

            return new Response('ok', { status: 200 });
        }) satisfies typeof fetch;

        await runtime!.fetch!('https://example.com', { headers: { 'x-api-key': 'placeholder' } });

        expect(calls.length).toBeGreaterThanOrEqual(2);
        expect(calls[0]!.url).toBe('https://api.minimax.io/oauth/token');

        const requestCall = calls.find((c) => c.url === 'https://example.com');
        expect(requestCall?.headers.get('x-api-key')).toBe('fresh-access');

        const store = await loadLlmAuthProfilesStore();
        const updated = store.profiles['minimax:portal_oauth_global'];
        expect(updated?.credential.type).toBe('oauth');
        if (updated?.credential.type === 'oauth') {
            expect(updated.credential.accessToken).toBe('fresh-access');
            expect(updated.credential.refreshToken).toBe('fresh-refresh');
            expect(updated.credential.expiresAt).toBeGreaterThan(Date.now());
        }
    });
});
