import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const GIG_ID = '00000000-0000-4000-8000-000000000001';

/** The poster tool as the Dexto MCP lists it: publish asks first and takes `confirm`. */
const POSTING_TOOL = {
    _meta: {
        'dexto/level': 'approve',
        'dexto/action_levels': { list_posted_gigs: 'read', publish_gig: 'approve' },
    },
    inputSchema: {
        properties: { action: {}, confirm: {}, description: {}, timeline: {}, title: {} },
    },
    name: 'dexto_gigs_posting',
    title: 'Dexto Gigs posting',
};
const PUBLISHED = {
    action: 'publish_gig',
    gig: { id: GIG_ID, status: 'open', title: 'Landing page' },
};

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

const REQUIRED = [
    '--title',
    'Landing page',
    '--description',
    'Build a landing page.',
    '--timeline',
    'Two weeks',
];

describe('dexto workspace gigs publish', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    /** A JSON-RPC refusal the MCP sends instead of a result, when set. */
    let refusal: { code: number; message: string; data?: unknown } | null;
    let host: CloudHost;

    const signIn = (scopes: string[]) =>
        dextoAccounts.writeLogin(dir, 'default', {
            kind: 'oauth',
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            clientId: 'dexto-cli',
            appUrl: 'https://app.dexto.ai',
            apiBaseUrl: 'https://api.dexto.ai',
            resource: MCP,
            tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
            scopes,
            savedAt: '2026-11-01T00:00:00.000Z',
            signedInAs: null,
            cloudProject: null,
        });

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-gig-publish-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        refusal = null;
        await signIn(['gigs:write']);
        const environment: Record<string, string> = {};
        const runtime: CloudRuntime = {
            color: false,
            environment,
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url.endsWith('/.well-known/oauth-protected-resource/mcp'))
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                if (request.url !== MCP) return Response.json({}, { status: 404 });
                const message = JSON.parse(await request.text());
                if (message.method === 'tools/list')
                    return Response.json({
                        jsonrpc: '2.0',
                        id: message.id,
                        result: { tools: [POSTING_TOOL] },
                    });
                if (message.method !== 'tools/call')
                    throw new Error(`Unexpected MCP method ${message.method}.`);
                const { arguments: args, name } = message.params;
                calls.push({ name, arguments: args });
                if (refusal !== null)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: refusal });
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [{ type: 'text', text: 'Published.' }],
                        structuredContent: PUBLISHED,
                    },
                });
            },
            prompt: null,
            readStdin: async () => '',
            runProcess: async () => ({ exitCode: 0, output: '' }),
            signal: new AbortController().signal,
            sleep: async () => undefined,
            stdoutIsTerminal: false,
            writeBytes: async () => undefined,
            writeError: (text) => {
                stderr += text;
            },
            writeOutput: (text) => {
                stdout += text;
            },
        };
        host = {
            commands: cloudCommands(dir, unusedSignIn),
            signIn: unusedSignIn,
            groups: CLOUD_GROUPS,
            runtime,
            resolveConnection: (overrides) =>
                resolveConnection({
                    dir,
                    environment,
                    overrides,
                    refresh: async (login: dextoAccounts.OAuthLogin) => login,
                }),
            signInForScopes: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    const publish = (...words: string[]) =>
        runCloud(host, ['workspace', 'gigs', 'publish', ...words]);

    it('publishes with the required inputs, agreed by --yes, and prints the reply as JSON', async () => {
        expect(await publish(...REQUIRED, '--yes', '--json')).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_gigs_posting',
                arguments: {
                    action: 'publish_gig',
                    confirm: true,
                    description: 'Build a landing page.',
                    tags: [],
                    timeline: 'Two weeks',
                    title: 'Landing page',
                },
            },
        ]);
        expect(JSON.parse(stdout)).toEqual(PUBLISHED);
    });

    it('maps tags, a budget in the currency units and a contract with its options', async () => {
        const options = [
            ...['--tag', 'web', '--tag', 'design'],
            ...['--budget', '499.5', '--currency', 'usd'],
            ...['--contract-skill', 'build-and-ship'],
            ...['--contract-option', 'web', '--contract-option', 'agents'],
        ];
        expect(await publish(...REQUIRED, ...options, '--yes', '--json')).toBe(0);

        expect(calls[0]?.arguments).toMatchObject({
            budget: { amountMinor: 49_950, currency: 'USD' },
            contract: { options: ['web', 'agents'], skill: 'build-and-ship' },
            tags: ['web', 'design'],
        });
    });

    it("takes a budget in a currency's own whole units and a contract's default options", async () => {
        const options = ['--budget', '1200', '--currency', 'JPY', '--contract-skill', 'review'];
        expect(await publish(...REQUIRED, ...options, '--yes', '--json')).toBe(0);

        expect(calls[0]?.arguments).toMatchObject({
            budget: { amountMinor: 1200, currency: 'JPY' },
            contract: { skill: 'review' },
        });
        expect(calls[0]?.arguments.contract).not.toHaveProperty('options');
    });

    it.each([
        [['--description', 'd', '--timeline', 't'], '--title is required'],
        [['--title', 't', '--timeline', 't'], '--description is required'],
        [['--title', 't', '--description', 'd'], '--timeline is required'],
        [[...REQUIRED, '--budget', '500'], '--budget and --currency go together'],
        [[...REQUIRED, '--currency', 'USD'], '--budget and --currency go together'],
        [[...REQUIRED, '--budget', '5.001', '--currency', 'USD'], '--budget must be an amount'],
        [[...REQUIRED, '--budget=-5', '--currency', 'USD'], '--budget must be an amount'],
        [[...REQUIRED, '--budget', '5.5', '--currency', 'JPY'], 'whole number of JPY'],
        [[...REQUIRED, '--budget', '0', '--currency', 'USD'], 'more than zero'],
        [[...REQUIRED, '--budget', '5', '--currency', 'dollars'], 'three-letter code'],
        [[...REQUIRED, '--contract-option', 'web'], '--contract-option needs --contract-skill'],
    ])('refuses %j before sending anything', async (words, message) => {
        expect(await publish(...words, '--yes', '--json')).toBe(2);

        expect(calls).toEqual([]);
        expect(stderr).toContain(message);
    });

    it('fails headless without --yes and publishes nothing', async () => {
        expect(await publish(...REQUIRED, '--json')).toBe(4);

        expect(calls).toEqual([]);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('needs_confirmation');
        expect(error.message).toContain('Publish the Gig "Landing page"');
        expect(error.fix).toContain('--yes');
    });

    it('shows a dry run without signing in or sending anything', async () => {
        await rm(dir, { recursive: true, force: true });

        expect(await publish(...REQUIRED, '--tag', 'web', '--dry-run', '--json')).toBe(0);

        expect(calls).toEqual([]);
        expect(JSON.parse(stdout)).toMatchObject({
            dryRun: true,
            checkedByDexto: false,
            tool: 'dexto_gigs_posting',
            arguments: { action: 'publish_gig', tags: ['web'], title: 'Landing page' },
        });
    });

    it('needs gigs:write before calling, and names the sign-in that grants it', async () => {
        await signIn(['gigs:read']);

        expect(await publish(...REQUIRED, '--yes', '--json')).toBe(3);

        expect(calls).toEqual([]);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('needs_permission');
        expect(error.fix).toContain('gigs:write');
    });

    it("keeps the Cloud's validation refusal as invalid input", async () => {
        refusal = {
            code: -32602,
            message: 'Invalid Dexto Gigs input.',
            data: { kind: 'invalid_arguments' },
        };

        expect(await publish(...REQUIRED, '--yes', '--json')).toBe(2);

        expect(calls).toHaveLength(1);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'invalid_input',
            message: 'Invalid Dexto Gigs input.',
        });
    });

    it("keeps the Cloud's own consent refusal", async () => {
        refusal = {
            code: -32003,
            message: 'Publishing a Gig needs your confirmation.',
            data: { kind: 'needs_confirmation', level: 'approve' },
        };

        expect(await publish(...REQUIRED, '--yes', '--json')).toBe(4);

        expect(JSON.parse(stderr).error).toMatchObject({ code: 'needs_confirmation' });
    });

    it("keeps the Cloud's scope refusal when the server asks for gigs:write", async () => {
        refusal = {
            code: -32003,
            message: 'Missing required scope: gigs:write.',
            data: { kind: 'forbidden', scope: 'gigs:write' },
        };

        expect(await publish(...REQUIRED, '--yes', '--json')).toBe(3);

        expect(JSON.parse(stderr).error.fix).toContain('gigs:write');
    });
});
