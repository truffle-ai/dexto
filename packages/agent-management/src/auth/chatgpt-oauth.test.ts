import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CHATGPT_OAUTH_REDIRECT_URI,
    createChatGPTRuntimeAuth,
    refreshChatGPTOAuthCredential,
    startChatGPTBrowserLogin,
} from './chatgpt-oauth.js';

const originalFetch = globalThis.fetch;

describe('chatgpt oauth runtime auth', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('uses the registered localhost redirect URI for OpenAI authorization', () => {
        expect(CHATGPT_OAUTH_REDIRECT_URI).toBe('http://localhost:1455/auth/callback');
    });

    it('starts and cancels the callback server without leaving the port claimed', async () => {
        const firstLogin = await startChatGPTBrowserLogin();
        expect(firstLogin.authUrl).toContain(
            'redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback'
        );
        await firstLogin.cancel();

        const secondLogin = await startChatGPTBrowserLogin();
        await secondLogin.cancel();
    });

    it('rejects a pending credential wait when the browser login is cancelled', async () => {
        const login = await startChatGPTBrowserLogin();
        const credential = login.waitForCredential();

        await login.cancel();

        await expect(credential).rejects.toThrow('ChatGPT Login cancelled');
    });

    it('sends native ChatGPT OAuth headers through the Codex endpoint', async () => {
        const response = new Response('{}', { status: 200 });
        const fetchMock = vi.fn().mockResolvedValue(response);
        globalThis.fetch = fetchMock;

        const auth = createChatGPTRuntimeAuth({
            credential: {
                type: 'oauth',
                issuer: 'https://auth.openai.com',
                refreshToken: 'refresh-token',
                accessToken: 'access-token',
                expiresAt: Date.now() + 3600_000,
                accountId: 'account-1',
            },
            updateCredential: vi.fn(),
        });

        await auth.fetch('https://api.openai.com/v1/responses', {
            headers: { authorization: 'Bearer dummy' },
            body: JSON.stringify({ model: 'gpt-5.4-mini', input: [] }),
        });

        expect(fetchMock).toHaveBeenCalledWith(
            'https://chatgpt.com/backend-api/codex/responses',
            expect.objectContaining({
                headers: expect.any(globalThis.Headers),
            })
        );
        const headers = fetchMock.mock.calls[0]?.[1]?.headers;
        if (!(headers instanceof globalThis.Headers)) {
            throw new Error('Expected Headers');
        }
        expect(headers.get('authorization')).toBe('Bearer access-token');
        expect(headers.get('ChatGPT-Account-Id')).toBe('account-1');
        expect(headers.get('originator')).toBe('dexto');
        expect(headers.get('OpenAI-Beta')).toBe('responses=experimental');
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
            instructions?: string;
            store?: boolean;
        };
        expect(body.instructions).toBe('You are a helpful assistant.');
        expect(body.store).toBe(false);
    });

    it('preserves Dexto system prompt messages as Codex instructions', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        globalThis.fetch = fetchMock;

        const auth = createChatGPTRuntimeAuth({
            credential: {
                type: 'oauth',
                issuer: 'https://auth.openai.com',
                refreshToken: 'refresh-token',
                accessToken: 'access-token',
                expiresAt: Date.now() + 3600_000,
            },
            updateCredential: vi.fn(),
        });

        await auth.fetch('https://api.openai.com/v1/responses', {
            body: JSON.stringify({
                model: 'gpt-5.4-mini',
                input: [
                    { role: 'system', content: 'agent system prompt' },
                    { role: 'developer', content: [{ type: 'text', text: 'prompt contributor' }] },
                    { role: 'user', content: 'hello' },
                ],
                instructions: 'existing instructions',
            }),
        });

        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
            instructions?: string;
            input?: Array<{ role: string }>;
            store?: boolean;
        };
        expect(body.instructions).toBe(
            'agent system prompt\n\nprompt contributor\n\nexisting instructions'
        );
        expect(body.input).toEqual([{ role: 'user', content: 'hello' }]);
        expect(body.store).toBe(false);
    });

    it('refreshes expired credentials and persists the replacement before request dispatch', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({
                    access_token: 'fresh-access',
                    refresh_token: 'fresh-refresh',
                    expires_in: 3600,
                })
            )
            .mockResolvedValueOnce(new Response('{}', { status: 200 }));
        globalThis.fetch = fetchMock;
        const updateCredential = vi.fn();

        const auth = createChatGPTRuntimeAuth({
            credential: {
                type: 'oauth',
                issuer: 'https://auth.openai.com',
                refreshToken: 'stale-refresh',
                accessToken: 'stale-access',
                expiresAt: 0,
                accountId: 'account-1',
            },
            updateCredential,
        });

        await auth.fetch('https://api.openai.com/v1/responses');

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'https://auth.openai.com/oauth/token',
            expect.objectContaining({ method: 'POST' })
        );
        expect(updateCredential).toHaveBeenCalledWith(
            expect.objectContaining({
                accessToken: 'fresh-access',
                refreshToken: 'fresh-refresh',
                accountId: 'account-1',
            })
        );
        const headers = fetchMock.mock.calls[1]?.[1]?.headers;
        if (!(headers instanceof globalThis.Headers)) {
            throw new Error('Expected Headers');
        }
        expect(headers.get('authorization')).toBe('Bearer fresh-access');
    });

    it('fails refresh loudly when OpenAI rejects the refresh token', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));

        await expect(
            refreshChatGPTOAuthCredential({
                type: 'oauth',
                issuer: 'https://auth.openai.com',
                refreshToken: 'bad-refresh',
                accessToken: 'old-access',
                expiresAt: 0,
            })
        ).rejects.toThrow('ChatGPT token refresh failed: 401');
    });
});
