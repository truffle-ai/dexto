import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { handleConnectCommand } from './index.js';
import {
    createDefaultLlmAuthResolver,
    getAuthMethodDefinition,
    getDefaultLlmAuthProfileId,
    isOauthAuthMethod,
} from '@dexto/agent-management';

vi.mock('open', () => ({ default: vi.fn() }));

vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    password: vi.fn(),
    confirm: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
    isCancel: vi.fn(() => false),
    log: { warn: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('/connect command integration', () => {
    let tempHomeDir: string;
    let previousHome: string | undefined;
    let originalFetch: typeof fetch | undefined;

    beforeEach(async () => {
        tempHomeDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-connect-integration-'));
        previousHome = process.env.HOME;
        process.env.HOME = tempHomeDir;
        originalFetch = globalThis.fetch;

        const prompts = await import('@clack/prompts');
        vi.mocked(prompts.isCancel).mockReturnValue(false);
    });

    afterEach(async () => {
        if (originalFetch) {
            globalThis.fetch = originalFetch;
        }

        if (previousHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = previousHome;
        }

        await fs.rm(tempHomeDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('stores a connected oauth profile that resolves into compatible runtime auth', async () => {
        const prompts = await import('@clack/prompts');
        const openBrowser = await import('open');

        vi.mocked(prompts.select)
            .mockResolvedValueOnce('minimax')
            .mockResolvedValueOnce('portal_oauth_global');

        const method = getAuthMethodDefinition('minimax', 'portal_oauth_global');
        if (!method || !isOauthAuthMethod(method)) {
            throw new Error('Expected minimax oauth method to be available');
        }

        vi.spyOn(method.oauth, 'start').mockResolvedValue({
            verificationUrl: 'https://example.com/verify',
            userCode: 'USER-CODE',
            waitForCompletion: async () => ({
                credential: {
                    type: 'oauth',
                    accessToken: 'oauth-access-token',
                    refreshToken: 'oauth-refresh-token',
                    expiresAt: Date.now() + 60_000,
                    metadata: {
                        clientId: 'client-id',
                        region: 'global',
                        resourceUrl: 'https://api.minimax.io/anthropic',
                    },
                },
            }),
        });

        await handleConnectCommand({ interactive: true });

        expect(openBrowser.default).toHaveBeenCalledWith('https://example.com/verify');
        await expect(getDefaultLlmAuthProfileId('minimax')).resolves.toBe(
            'minimax:portal_oauth_global'
        );

        const resolver = createDefaultLlmAuthResolver();
        const runtime = resolver.resolveRuntimeAuth({ provider: 'minimax', model: 'MiniMax-M2.1' });

        expect(runtime?.apiKey).toBe('dexto-oauth-dummy-key');
        expect(runtime?.baseURL).toBe('https://api.minimax.io/anthropic/v1');
        expect(typeof runtime?.fetch).toBe('function');

        const calls: Array<{ headers: globalThis.Headers }> = [];
        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ headers: new globalThis.Headers(init?.headers) });
            return new Response('ok', { status: 200 });
        }) satisfies typeof fetch;

        await runtime!.fetch!('https://example.com', {
            headers: {
                'x-api-key': 'placeholder',
                authorization: 'Bearer placeholder',
            },
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]!.headers.get('x-api-key')).toBe('oauth-access-token');
        expect(calls[0]!.headers.get('authorization')).toBe(null);
    });
});
