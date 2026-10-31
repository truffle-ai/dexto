import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    DEXTO_CLI_CLIENT_ID,
    type SignInRuntime,
    endSignIn,
    refreshSignIn,
    signInWithBrowser,
    signInWithDevice,
} from './sign-in.js';
import type { OAuthLogin } from './accounts.js';

const APP = 'https://app.dexto.ai';
const API = 'https://api.dexto.ai';
const REDIRECT = 'http://127.0.0.1:53682/callback';

const tokenReply = {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_in: 3600,
    scope: 'cloud:read drive:read memory:read',
    dexto_account: { email: 'ada@example.com', id: 'acc_1', name: 'Ada' },
    dexto_organization: { id: 'org_1', name: 'Acme', slug: 'acme' },
};

interface Call {
    readonly url: string;
    readonly method: string;
    readonly body: URLSearchParams | null;
}

type Route = (call: Call) => { status: number; body: unknown } | undefined;

function fakeServer(route: Route) {
    const calls: Call[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = String(input);
        const raw = init?.body;
        const call: Call = {
            url,
            method: init?.method ?? 'GET',
            body: raw instanceof URLSearchParams ? raw : null,
        };
        calls.push(call);
        const reply = metadata(url) ?? route(call);
        if (reply === undefined) throw new Error(`unexpected ${call.method} ${url}`);
        return new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: { 'content-type': 'application/json' },
        });
    };
    return { calls, fetch };
}

function metadata(url: string): { status: number; body: unknown } | undefined {
    if (url === `${APP}/.well-known/oauth-protected-resource/mcp`)
        return {
            status: 200,
            body: {
                resource: `${APP}/mcp`,
                authorization_servers: [APP],
                scopes_supported: ['drive:read', 'drive:write', 'memory:read'],
            },
        };
    if (url === `${APP}/.well-known/oauth-authorization-server`)
        return {
            status: 200,
            body: {
                authorization_endpoint: `${APP}/oauth/authorize`,
                device_authorization_endpoint: `${APP}/api/oauth/device_authorization`,
                registration_endpoint: `${APP}/api/oauth/register`,
                revocation_endpoint: `${APP}/api/oauth/revoke`,
                token_endpoint: `${APP}/api/oauth/token`,
            },
        };
    return undefined;
}

function runtime(
    fetch: typeof globalThis.fetch,
    overrides: Partial<SignInRuntime> = {}
): SignInRuntime & { readonly notes: string[]; readonly opened: string[] } {
    const notes: string[] = [];
    const opened: string[] = [];
    return {
        notes,
        opened,
        fetch,
        signal: new AbortController().signal,
        note: (text) => notes.push(text),
        openBrowser: async (url) => {
            opened.push(url);
        },
        listenForRedirect: async () => {
            throw new Error('no redirect listener in this test');
        },
        sleep: async () => undefined,
        ...overrides,
    };
}

describe('signInWithBrowser', () => {
    it('signs in as dexto-cli with PKCE on a loopback redirect, without registering', async () => {
        let challenge = '';
        const server = fakeServer((call) => {
            if (call.url === `${APP}/api/oauth/token` && call.method === 'POST') {
                const verifier = call.body?.get('code_verifier') ?? '';
                const expected = createHash('sha256').update(verifier).digest('base64url');
                if (expected !== challenge)
                    return { status: 400, body: { error: 'invalid_grant' } };
                return { status: 200, body: tokenReply };
            }
            return undefined;
        });
        let closed = false;
        let reply: (params: URLSearchParams) => void = () => undefined;
        const fake = runtime(server.fetch, {
            listenForRedirect: async () => ({
                redirectUri: REDIRECT,
                result: new Promise<URLSearchParams>((done) => {
                    reply = done;
                }),
                close: () => {
                    closed = true;
                },
            }),
            openBrowser: async (url) => {
                fake.opened.push(url);
                const authorize = new URL(url);
                challenge = authorize.searchParams.get('code_challenge') ?? '';
                reply(
                    new URLSearchParams({
                        code: 'code-1',
                        state: authorize.searchParams.get('state') ?? '',
                    })
                );
            },
        });

        const signedIn = await signInWithBrowser(fake, {
            appUrl: APP,
            apiBaseUrl: API,
            organization: 'acme',
            extraScopes: ['drive:write'],
            openBrowser: true,
        });

        const authorize = new URL(fake.opened[0] ?? '');
        expect(authorize.origin + authorize.pathname).toBe(`${APP}/oauth/authorize`);
        expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
            client_id: DEXTO_CLI_CLIENT_ID,
            code_challenge_method: 'S256',
            redirect_uri: REDIRECT,
            resource: `${APP}/mcp`,
            response_type: 'code',
            scope: 'drive:read memory:read cloud:read drive:write',
            organization: 'acme',
        });
        expect(server.calls.some((call) => call.url.endsWith('/register'))).toBe(false);
        const token = server.calls.find((call) => call.url === `${APP}/api/oauth/token`);
        expect(token?.body?.get('client_id')).toBe(DEXTO_CLI_CLIENT_ID);
        expect(token?.body?.get('redirect_uri')).toBe(REDIRECT);
        expect(closed).toBe(true);
        expect(signedIn).toMatchObject({
            kind: 'oauth',
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            clientId: DEXTO_CLI_CLIENT_ID,
            appUrl: APP,
            apiBaseUrl: API,
            resource: `${APP}/mcp`,
            tokenEndpoint: `${APP}/api/oauth/token`,
            scopes: ['cloud:read', 'drive:read', 'memory:read'],
            signedInAs: {
                account: tokenReply.dexto_account,
                organization: tokenReply.dexto_organization,
            },
        });
    });

    it('refuses a reply whose state does not match', async () => {
        const server = fakeServer(() => undefined);
        const fake = runtime(server.fetch, {
            listenForRedirect: async () => ({
                redirectUri: REDIRECT,
                result: Promise.resolve(new URLSearchParams({ code: 'c', state: 'forged' })),
                close: () => undefined,
            }),
        });

        await expect(
            signInWithBrowser(fake, {
                appUrl: APP,
                apiBaseUrl: API,
                organization: null,
                extraScopes: [],
                openBrowser: false,
            })
        ).rejects.toThrow(/didn't match/);
        expect(fake.opened).toEqual([]);
        expect(fake.notes.join('\n')).toContain(`${APP}/oauth/authorize`);
    });

    it('says when the person declined', async () => {
        const server = fakeServer(() => undefined);
        let state = '';
        let reply: (params: URLSearchParams) => void = () => undefined;
        const fake = runtime(server.fetch, {
            listenForRedirect: async () => ({
                redirectUri: REDIRECT,
                result: new Promise<URLSearchParams>((done) => {
                    reply = done;
                }),
                close: () => undefined,
            }),
            openBrowser: async (url) => {
                state = new URL(url).searchParams.get('state') ?? '';
                reply(new URLSearchParams({ error: 'access_denied', state }));
            },
        });

        await expect(
            signInWithBrowser(fake, {
                appUrl: APP,
                apiBaseUrl: API,
                organization: null,
                extraScopes: [],
                openBrowser: true,
            })
        ).rejects.toThrow('Sign-in was declined.');
    });
});

describe('signInWithDevice', () => {
    it('polls as dexto-cli until approved, slowing down when asked', async () => {
        const replies = [
            { status: 400, body: { error: 'authorization_pending' } },
            { status: 400, body: { error: 'slow_down' } },
            { status: 200, body: tokenReply },
        ];
        const server = fakeServer((call) => {
            if (call.url === `${APP}/api/oauth/device_authorization`)
                return {
                    status: 200,
                    body: {
                        device_code: 'device-1',
                        user_code: 'ABCD-EFGH',
                        expires_in: 600,
                        interval: 5,
                        verification_uri: `${APP}/device`,
                        verification_uri_complete: `${APP}/device?code=ABCD-EFGH`,
                    },
                };
            if (call.url === `${APP}/api/oauth/token`) return replies.shift();
            return undefined;
        });
        const slept: number[] = [];
        const fake = runtime(server.fetch, {
            sleep: async (ms) => {
                slept.push(ms);
            },
        });

        const signedIn = await signInWithDevice(fake, {
            appUrl: APP,
            apiBaseUrl: API,
            organization: null,
            extraScopes: [],
        });

        const start = server.calls.find((call) => call.url.endsWith('/device_authorization'));
        expect(start?.body?.get('client_id')).toBe(DEXTO_CLI_CLIENT_ID);
        expect(start?.body?.get('scope')).toBe('drive:read memory:read cloud:read');
        expect(server.calls.some((call) => call.url.endsWith('/register'))).toBe(false);
        const polls = server.calls.filter((call) => call.url === `${APP}/api/oauth/token`);
        expect(polls.map((call) => call.body?.get('grant_type'))).toEqual([
            'urn:ietf:params:oauth:grant-type:device_code',
            'urn:ietf:params:oauth:grant-type:device_code',
            'urn:ietf:params:oauth:grant-type:device_code',
        ]);
        expect(polls.every((call) => call.body?.get('client_id') === DEXTO_CLI_CLIENT_ID)).toBe(
            true
        );
        expect(slept).toEqual([5000, 5000, 10000]);
        expect(fake.notes.join('\n')).toContain('ABCD-EFGH');
        expect(fake.notes.join('\n')).toContain('Only approve this if you just ran dexto login');
        expect(signedIn.clientId).toBe(DEXTO_CLI_CLIENT_ID);
    });

    it('says when the person declined', async () => {
        const server = fakeServer((call) => {
            if (call.url.endsWith('/device_authorization'))
                return {
                    status: 200,
                    body: {
                        device_code: 'd',
                        user_code: 'U',
                        expires_in: 600,
                        verification_uri: `${APP}/device`,
                    },
                };
            if (call.url.endsWith('/token'))
                return { status: 400, body: { error: 'access_denied' } };
            return undefined;
        });

        await expect(
            signInWithDevice(runtime(server.fetch), {
                appUrl: APP,
                apiBaseUrl: API,
                organization: null,
                extraScopes: [],
            })
        ).rejects.toThrow('Sign-in was declined.');
    });
});

const saved: OAuthLogin = {
    kind: 'oauth',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: '2026-10-31T00:00:00.000Z',
    clientId: 'client_registered',
    appUrl: APP,
    apiBaseUrl: API,
    resource: `${APP}/mcp`,
    tokenEndpoint: `${APP}/api/oauth/token`,
    scopes: ['cloud:read'],
    savedAt: '2026-10-30T00:00:00.000Z',
    signedInAs: null,
};

describe('refreshSignIn', () => {
    it('trades the refresh token as the client that signed in', async () => {
        const server = fakeServer((call) =>
            call.url === `${APP}/api/oauth/token`
                ? { status: 200, body: { ...tokenReply, access_token: 'access-2' } }
                : undefined
        );

        const refreshed = await refreshSignIn(runtime(server.fetch), saved);

        const body = server.calls[0]?.body;
        expect(body?.get('grant_type')).toBe('refresh_token');
        expect(body?.get('refresh_token')).toBe('refresh-1');
        expect(body?.get('client_id')).toBe('client_registered');
        expect(body?.get('resource')).toBe(`${APP}/mcp`);
        expect(refreshed).toMatchObject({
            accessToken: 'access-2',
            refreshToken: 'refresh-1',
            clientId: 'client_registered',
            signedInAs: { organization: { slug: 'acme' } },
        });
    });

    it('asks to sign in again when the refresh token was refused', async () => {
        const server = fakeServer(() => ({ status: 400, body: { error: 'invalid_grant' } }));

        await expect(refreshSignIn(runtime(server.fetch), saved)).rejects.toThrow(
            'Your Dexto sign-in has expired. Run dexto login again.'
        );
    });
});

describe('endSignIn', () => {
    it('revokes the refresh token on the server', async () => {
        const server = fakeServer((call) =>
            call.url === `${APP}/api/oauth/revoke` ? { status: 200, body: null } : undefined
        );

        await expect(endSignIn(runtime(server.fetch), saved)).resolves.toEqual({
            status: 'ended',
        });
        const revoke = server.calls.find((call) => call.url.endsWith('/revoke'));
        expect(Object.fromEntries(revoke?.body ?? [])).toEqual({
            client_id: 'client_registered',
            token: 'refresh-1',
            token_type_hint: 'refresh_token',
        });
    });

    it('reports a failure instead of throwing', async () => {
        const server = fakeServer(() => ({ status: 503, body: { error: 'unavailable' } }));

        await expect(endSignIn(runtime(server.fetch), saved)).resolves.toMatchObject({
            status: 'failed',
        });
    });
});
