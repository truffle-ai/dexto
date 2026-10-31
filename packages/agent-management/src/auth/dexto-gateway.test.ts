import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type OAuthLogin, writeLogin } from './dexto-accounts.js';
import { createModelAuthResolver } from './model-auth-handlers.js';
import {
    type DextoGatewayOptions,
    dextoGatewayRuntimeAuth,
    dextoModelAccess,
} from './dexto-gateway.js';

const API = 'https://api.dexto.ai';
const PREVIEW_API = 'https://api.preview.dexto.dev';

function signedIn(overrides: Partial<OAuthLogin> = {}): OAuthLogin {
    return {
        kind: 'oauth',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: 'https://app.dexto.ai',
        apiBaseUrl: API,
        resource: 'https://app.dexto.ai/mcp',
        tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        scopes: ['cloud:read', 'cloud:write'],
        savedAt: '2026-10-31T00:00:00.000Z',
        signedInAs: null,
        cloudProject: { id: 'prj_main', name: 'Main' },
        ...overrides,
    };
}

describe('Dexto models on the sign-in', () => {
    let dir: string;
    let sent: { url: string; headers: globalThis.Headers }[];
    let options: DextoGatewayOptions;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-gateway-')), 'accounts');
        sent = [];
        options = {
            dir,
            environment: {},
            apiBaseUrl: API,
            fetch: async (input, init) => {
                sent.push({ url: String(input), headers: new globalThis.Headers(init?.headers) });
                return new Response('{}', { status: 200 });
            },
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

    async function call(): Promise<void> {
        const auth = dextoGatewayRuntimeAuth(options);
        expect(auth).not.toBeNull();
        await auth?.fetch?.(`${API}/v1/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${auth.apiKey}` },
            body: '{}',
        });
    }

    it('leaves DEXTO_API_KEY to the 1.x key path', () => {
        options = { ...options, environment: { DEXTO_API_KEY: 'dxt_env' } };
        expect(dextoGatewayRuntimeAuth(options)).toBeNull();
    });

    it("sends the sign-in's token and Cloud project to the public API", async () => {
        await writeLogin(dir, 'default', signedIn());

        const auth = dextoGatewayRuntimeAuth(options);
        expect(auth).toMatchObject({ baseURL: `${API}/v1` });
        await call();

        expect(sent).toHaveLength(1);
        expect(sent[0]?.url).toBe(`${API}/v1/chat/completions`);
        expect(sent[0]?.headers.get('authorization')).toBe('Bearer access-1');
        expect(sent[0]?.headers.get('dexto-cloud-project')).toBe('prj_main');
    });

    it('goes to the API the sign-in was saved for, such as a preview', async () => {
        await writeLogin(dir, 'default', signedIn({ apiBaseUrl: PREVIEW_API }));

        await call();

        expect(sent[0]?.url).toBe(`${PREVIEW_API}/v1/chat/completions`);
    });

    it('refreshes an expiring sign-in before the request', async () => {
        await writeLogin(dir, 'default', signedIn({ expiresAt: new Date().toISOString() }));

        await call();

        expect(sent[0]?.headers.get('authorization')).toBe('Bearer access-2');
    });

    it('sends a saved API key as itself, with no project', async () => {
        await writeLogin(dir, 'default', {
            kind: 'api_key',
            apiKey: 'dxt_saved',
            apiBaseUrl: API,
            savedAt: '2026-10-31T00:00:00.000Z',
        });

        await call();

        expect(sent[0]?.headers.get('authorization')).toBe('Bearer dxt_saved');
        expect(sent[0]?.headers.has('dexto-cloud-project')).toBe(false);
    });

    it('says how to sign in when signed out', async () => {
        await expect(call()).rejects.toThrow(
            'Dexto models need a Dexto sign-in. Run dexto login, or choose another provider.'
        );
        expect(sent).toHaveLength(0);
    });

    it('says how to allow spending credits when the sign-in only reads', async () => {
        await writeLogin(dir, 'default', signedIn({ scopes: ['cloud:read'] }));

        await expect(call()).rejects.toThrow(
            'Dexto models spend credits, which this sign-in may not do yet. Run dexto login --scope cloud:write.'
        );
    });

    it('says when there is no Cloud project to bill', async () => {
        await writeLogin(dir, 'default', signedIn({ cloudProject: null }));

        await expect(call()).rejects.toThrow(/no Cloud project/);
    });

    it('tells whether Dexto models can be used, and why not', async () => {
        await expect(dextoModelAccess(options)).resolves.toEqual({
            status: 'signed_out',
        });
        await writeLogin(dir, 'default', signedIn({ scopes: ['cloud:read'] }));
        await expect(dextoModelAccess(options)).resolves.toEqual({
            status: 'needs_scope',
        });
        await writeLogin(dir, 'default', signedIn());
        await expect(dextoModelAccess(options)).resolves.toEqual({ status: 'ready' });
        options = { ...options, environment: { DEXTO_API_KEY: 'dxt_env' } };
        await expect(dextoModelAccess(options)).resolves.toEqual({ status: 'ready' });
    });

    it('is how the model auth resolver runs dexto-nova', async () => {
        await writeLogin(dir, 'default', signedIn());

        const auth = createModelAuthResolver(options).resolveRuntimeAuth({
            provider: 'dexto-nova',
            model: 'anthropic/claude-sonnet-4.5',
        });

        expect(auth).toMatchObject({ baseURL: `${API}/v1` });
        expect(auth?.fetch).toBeTypeOf('function');
    });
});
