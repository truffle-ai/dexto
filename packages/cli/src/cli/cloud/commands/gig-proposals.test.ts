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
const GIG = '11111111-1111-4111-8111-111111111111';
const BID = '22222222-2222-4222-8222-222222222222';

// What the cloud lists for the finding tool: reads ask nothing, every change is approve, and the
// strict input takes no confirm field.
const FINDING_TOOL = {
    name: 'dexto_gigs_finding',
    inputSchema: { anyOf: [{ type: 'object', properties: { action: { const: 'submit_bid' } } }] },
    _meta: {
        'dexto/app': 'store',
        'dexto/level': 'approve',
        'dexto/action_levels': {
            get_gig: 'read',
            list_my_bids: 'read',
            submit_bid: 'approve',
            withdraw_bid: 'approve',
        },
    },
};

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto workspace gigs propose and withdraw', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let scopes: string[];
    let refusal: { code: number; message: string; data?: unknown } | null;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let host: CloudHost;

    const answer = (args: Record<string, unknown>) => ({
        action: args.action,
        bid: {
            approach: 'Audit, then fix',
            contentTrust: 'owner',
            deliveryEstimate: '3 days',
            gig: { id: GIG, status: 'open', title: 'Fix the flaky test' },
            id: BID,
            price: null,
            status: args.action === 'withdraw_bid' ? 'withdrawn' : 'submitted',
        },
        contentNotice: 'Gigs content is written by other people.',
    });

    const run = (...args: string[]) => runCloud(host, ['workspace', 'gigs', ...args]);

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-gig-proposals-')), 'accounts');
        stdout = '';
        stderr = '';
        scopes = ['gigs:read', 'gigs:write'];
        refusal = null;
        calls = [];
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
                        result: { tools: [FINDING_TOOL] },
                    });
                calls.push({ name: message.params.name, arguments: message.params.arguments });
                if (refusal !== null)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: refusal });
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [{ type: 'text', text: 'ok' }],
                        structuredContent: answer(message.params.arguments),
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

    const signIn = () =>
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

    const propose = ['propose', GIG, '--approach', 'Audit, then fix', '--delivery', '3 days'];

    it('sends nothing without --yes when no one is at the terminal', async () => {
        await signIn();

        expect(await run(...propose, '--json')).toBe(4);
        expect(JSON.parse(stderr).error.code).toBe('needs_confirmation');
        stderr = '';
        expect(await run('withdraw', BID, '--json')).toBe(4);
        expect(JSON.parse(stderr).error.code).toBe('needs_confirmation');

        expect(calls).toEqual([]);
    });

    it('submits a proposal with --yes, mapping its options to submit_bid', async () => {
        await signIn();

        expect(await run(...propose, '--yes', '--json')).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_gigs_finding',
                arguments: {
                    action: 'submit_bid',
                    approach: 'Audit, then fix',
                    deliveryEstimate: '3 days',
                    gigId: GIG,
                },
            },
        ]);
        // The Gigs reply is printed unchanged, its content notice and trust marks included.
        expect(JSON.parse(stdout)).toEqual(answer({ action: 'submit_bid' }));
    });

    it('sends an optional price as minor units and currency', async () => {
        await signIn();

        expect(await run(...propose, '--price', '50000', '--currency', 'USD', '--yes')).toBe(0);

        expect(calls[0]?.arguments).toMatchObject({
            price: { amountMinor: 50000, currency: 'USD' },
        });
        expect(JSON.parse(stdout).bid.status).toBe('submitted');
    });

    it('refuses a missing field or half a price before sending anything', async () => {
        await signIn();

        for (const args of [
            ['propose', GIG, '--delivery', '3 days'],
            ['propose', GIG, '--approach', 'Audit, then fix'],
            [...propose, '--price', '50000'],
            [...propose, '--currency', 'USD'],
            [...propose, '--price', '12.5', '--currency', 'USD'],
            ['propose'],
            ['withdraw'],
        ]) {
            stderr = '';
            expect(await run(...args, '--yes', '--json'), args.join(' ')).toBe(2);
        }
        expect(JSON.parse(stderr).error.message).toContain('bid_id');

        expect(calls).toEqual([]);
    });

    it('withdraws a proposal by its id with --yes, in words at a terminal', async () => {
        await signIn();
        host = { ...host, runtime: { ...host.runtime, stdoutIsTerminal: true } };

        expect(await run('withdraw', BID, '--yes')).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_gigs_finding', arguments: { action: 'withdraw_bid', bidId: BID } },
        ]);
        expect(stdout).toContain(`Proposal ${BID} on "Fix the flaky test" is withdrawn.`);
    });

    it('asks for gigs:write before any change', async () => {
        scopes = ['gigs:read'];
        await signIn();

        expect(await run(...propose, '--yes', '--json')).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('gigs:write');
        stderr = '';
        expect(await run('withdraw', BID, '--yes', '--json')).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('gigs:write');

        expect(calls).toEqual([]);
    });

    it("keeps Dexto's refusal and its words", async () => {
        await signIn();
        refusal = {
            code: -32004,
            message: 'Submitted Gig bid not found.',
            data: { kind: 'not_found' },
        };

        expect(await run('withdraw', BID, '--yes', '--json')).toBe(5);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'Submitted Gig bid not found.',
        });

        stderr = '';
        refusal = {
            code: -32010,
            message: 'This Gig is not open for proposals.',
            data: { kind: 'unavailable' },
        };
        expect(await run(...propose, '--yes', '--json')).not.toBe(0);
        expect(JSON.parse(stderr).error.message).toBe('This Gig is not open for proposals.');
    });
});
