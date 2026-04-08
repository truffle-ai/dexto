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
        if (previousMiniMaxClientId === undefined) {
            delete process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID;
        } else {
            process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID = previousMiniMaxClientId;
        }

        if (previousHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = previousHome;
        }
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

    it('resolves openai ChatGPT Login profiles to the Codex app-server base URL', async () => {
        await upsertLlmAuthProfile({
            profileId: 'openai:chatgpt_login',
            providerId: 'openai',
            methodId: 'chatgpt_login',
            credential: {
                type: 'external_account',
                system: 'codex',
                authMode: 'chatgpt',
                metadata: {
                    email: 'user@example.com',
                    planType: 'plus',
                },
            },
        });
        await setDefaultLlmAuthProfile({
            providerId: 'openai',
            profileId: 'openai:chatgpt_login',
        });

        const resolver = createDefaultLlmAuthResolver();
        const runtime = resolver.resolveRuntimeAuth({ provider: 'openai', model: 'gpt-4o-mini' });
        expect(runtime).toEqual({
            baseURL: 'codex://chatgpt',
        });
    });

    it('skips default auth profiles when explicit config already selects apiKey or baseURL', async () => {
        await upsertLlmAuthProfile({
            profileId: 'openai:chatgpt_login',
            providerId: 'openai',
            methodId: 'chatgpt_login',
            credential: {
                type: 'external_account',
                system: 'codex',
                authMode: 'chatgpt',
            },
        });
        await setDefaultLlmAuthProfile({
            providerId: 'openai',
            profileId: 'openai:chatgpt_login',
        });

        const resolver = createDefaultLlmAuthResolver();

        expect(
            resolver.resolveRuntimeAuth({
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: 'sk-explicit',
            })
        ).toBeNull();

        expect(
            resolver.resolveRuntimeAuth({
                provider: 'openai',
                model: 'gpt-4o-mini',
                baseURL: 'https://api.openai.com/v1',
            })
        ).toBeNull();
    });

    it('preserves Request headers when init.headers is omitted', async () => {
        await upsertLlmAuthProfile({
            profileId: 'minimax:portal_oauth_cn',
            providerId: 'minimax',
            methodId: 'portal_oauth_cn',
            credential: {
                type: 'oauth',
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() + 60_000,
                metadata: { region: 'cn' },
            },
        });
        await setDefaultLlmAuthProfile({
            providerId: 'minimax',
            profileId: 'minimax:portal_oauth_cn',
        });

        const resolver = createDefaultLlmAuthResolver();
        const runtime = resolver.resolveRuntimeAuth({ provider: 'minimax', model: 'MiniMax-M2.1' });
        expect(runtime?.apiKey).toBe('dexto-oauth-dummy-key');
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

        const request = new globalThis.Request('https://example.com', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Custom': 'abc',
                'x-api-key': 'placeholder',
            },
            body: JSON.stringify({ hello: 'world' }),
        });

        await runtime!.fetch!(request);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe('https://example.com/');
        expect(calls[0]!.headers.get('content-type')).toBe('application/json');
        expect(calls[0]!.headers.get('x-custom')).toBe('abc');
        expect(calls[0]!.headers.get('x-api-key')).toBe('access-token');
    });

    it('overlays init.headers on top of Request headers', async () => {
        await upsertLlmAuthProfile({
            profileId: 'minimax:portal_oauth_cn',
            providerId: 'minimax',
            methodId: 'portal_oauth_cn',
            credential: {
                type: 'oauth',
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() + 60_000,
                metadata: { region: 'cn' },
            },
        });
        await setDefaultLlmAuthProfile({
            providerId: 'minimax',
            profileId: 'minimax:portal_oauth_cn',
        });

        const resolver = createDefaultLlmAuthResolver();
        const runtime = resolver.resolveRuntimeAuth({ provider: 'minimax', model: 'MiniMax-M2.1' });
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

        const request = new globalThis.Request('https://example.com', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Custom': 'old',
            },
            body: JSON.stringify({ hello: 'world' }),
        });

        await runtime!.fetch!(request, {
            headers: { 'X-Custom': 'new', 'x-api-key': 'placeholder' },
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]!.headers.get('content-type')).toBe('application/json');
        expect(calls[0]!.headers.get('x-custom')).toBe('new');
        expect(calls[0]!.headers.get('x-api-key')).toBe('access-token');
    });

    it('refreshes minimax oauth tokens when expired', async () => {
        delete process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID;

        await upsertLlmAuthProfile({
            profileId: 'minimax:portal_oauth_global',
            providerId: 'minimax',
            methodId: 'portal_oauth_global',
            credential: {
                type: 'oauth',
                accessToken: 'stale-access',
                refreshToken: 'stale-refresh',
                expiresAt: Date.now() - 1,
                metadata: { region: 'global', clientId: 'client-id' },
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
                expect(body).toContain('client_id=client-id');
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

    it('dedupes concurrent minimax oauth refresh calls for the same profile', async () => {
        delete process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID;

        await upsertLlmAuthProfile({
            profileId: 'minimax:portal_oauth_global',
            providerId: 'minimax',
            methodId: 'portal_oauth_global',
            credential: {
                type: 'oauth',
                accessToken: 'stale-access',
                refreshToken: 'stale-refresh',
                expiresAt: Date.now() - 1,
                metadata: { region: 'global', clientId: 'client-id' },
            },
        });
        await setDefaultLlmAuthProfile({
            providerId: 'minimax',
            profileId: 'minimax:portal_oauth_global',
        });

        const resolver = createDefaultLlmAuthResolver();
        const runtime = resolver.resolveRuntimeAuth({ provider: 'minimax', model: 'MiniMax-M2.1' });
        expect(typeof runtime?.fetch).toBe('function');

        let refreshCalls = 0;
        const requestCalls: Array<{ url: string; headers: globalThis.Headers }> = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                input instanceof URL
                    ? input.toString()
                    : typeof input === 'string'
                      ? input
                      : input.url;

            if (url === 'https://api.minimax.io/oauth/token') {
                refreshCalls += 1;
                await new Promise((resolve) => setTimeout(resolve, 50));
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

            requestCalls.push({ url, headers: new globalThis.Headers(init?.headers) });
            return new Response('ok', { status: 200 });
        }) satisfies typeof fetch;

        await Promise.all([
            runtime!.fetch!('https://example.com/one', { headers: { 'x-api-key': 'placeholder' } }),
            runtime!.fetch!('https://example.com/two', { headers: { 'x-api-key': 'placeholder' } }),
        ]);

        expect(refreshCalls).toBe(1);
        expect(requestCalls).toHaveLength(2);
        expect(requestCalls[0]!.headers.get('x-api-key')).toBe('fresh-access');
        expect(requestCalls[1]!.headers.get('x-api-key')).toBe('fresh-access');
    });

    const minimaxOauthVariants = [
        {
            providerId: 'minimax',
            methodId: 'portal_oauth_global',
            region: 'global',
            expectedBaseUrl: 'https://api.minimax.io/anthropic/v1',
        },
        {
            providerId: 'minimax-cn',
            methodId: 'portal_oauth_cn',
            region: 'cn',
            expectedBaseUrl: 'https://api.minimaxi.com/anthropic/v1',
        },
        {
            providerId: 'minimax-coding-plan',
            methodId: 'portal_oauth_global',
            region: 'global',
            expectedBaseUrl: 'https://api.minimax.io/anthropic/v1',
        },
        {
            providerId: 'minimax-cn-coding-plan',
            methodId: 'portal_oauth_cn',
            region: 'cn',
            expectedBaseUrl: 'https://api.minimaxi.com/anthropic/v1',
        },
    ] as const satisfies ReadonlyArray<{
        providerId: 'minimax' | 'minimax-cn' | 'minimax-coding-plan' | 'minimax-cn-coding-plan';
        methodId: 'portal_oauth_global' | 'portal_oauth_cn';
        region: 'global' | 'cn';
        expectedBaseUrl: string;
    }>;

    it.each(minimaxOauthVariants)(
        'resolves oauth-backed provider variant $providerId through shared auth definitions',
        async ({ providerId, methodId, region, expectedBaseUrl }) => {
            await upsertLlmAuthProfile({
                profileId: `${providerId}:${methodId}`,
                providerId,
                methodId,
                credential: {
                    type: 'oauth',
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                    expiresAt: Date.now() + 60_000,
                    metadata: { region, clientId: 'client-id' },
                },
            });
            await setDefaultLlmAuthProfile({
                providerId,
                profileId: `${providerId}:${methodId}`,
            });

            const resolver = createDefaultLlmAuthResolver();
            const runtime = resolver.resolveRuntimeAuth({
                provider: providerId,
                model: 'MiniMax-M2.1',
            });

            expect(runtime?.apiKey).toBe('dexto-oauth-dummy-key');
            expect(runtime?.baseURL).toBe(expectedBaseUrl);
            expect(typeof runtime?.fetch).toBe('function');
        }
    );
});
