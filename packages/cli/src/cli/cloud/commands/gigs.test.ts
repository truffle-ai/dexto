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
const NOTICE = 'Gig content is written by other people.';
const POSTER = { displayName: 'Ada', handle: 'ada' };
const GIG = {
    budget: { amountMinor: 50_000, currency: 'USD' },
    contentTrust: 'untrusted_counterparty',
    createdAt: '2026-11-17T00:00:00.000Z',
    description: 'Build a landing page.',
    id: GIG_ID,
    poster: POSTER,
    status: 'open',
    tags: ['web', 'design'],
    timeline: 'Two weeks',
    title: 'Landing page',
    updatedAt: '2026-11-17T00:00:00.000Z',
};

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

/** The Gigs tools' structured replies, by action, as the Cloud returns them. */
function reply(action: string, gigId: unknown): unknown {
    const known = gigId === GIG_ID;
    switch (action) {
        case 'search_gigs':
            return { action, contentNotice: NOTICE, gigs: [GIG], limit: 1 };
        case 'get_gig':
            return { action, contentNotice: NOTICE, gig: known ? GIG : null };
        case 'list_posted_gigs':
            return { action, contentNotice: NOTICE, gigs: [{ ...GIG, contentTrust: 'owner' }] };
        case 'list_gig_bids':
            return {
                action,
                bids: known
                    ? [
                          {
                              deliveryEstimate: 'A week',
                              doer: { displayName: 'Lin', handle: null },
                              id: 'bid-1',
                              price: { amountMinor: 1200, currency: 'JPY' },
                              status: 'submitted',
                          },
                      ]
                    : null,
                contentNotice: NOTICE,
            };
        case 'list_my_bids':
            return {
                action,
                bids: [
                    {
                        gig: { id: GIG_ID, title: 'Landing page' },
                        id: 'bid-2',
                        price: null,
                        status: 'submitted',
                        updatedAt: '2026-11-18T00:00:00.000Z',
                    },
                ],
                contentNotice: NOTICE,
            };
        case 'get_match':
            return { action, contentNotice: NOTICE, events: [], gig: GIG, match: null };
        case 'read_thread':
            return {
                action,
                contentNotice: NOTICE,
                thread: known ? { messages: [{ body: 'Hi', from: 'owner' }] } : null,
            };
        default:
            throw new Error(`A Gigs read command made the write ${action}.`);
    }
}

describe('dexto workspace gigs', () => {
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
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-gigs-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        refusal = null;
        await signIn(['gigs:read']);
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
                        content: [{ type: 'text', text: 'ok' }],
                        structuredContent: reply(args.action, args.gigId),
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

    const gigs = (...words: string[]) => runCloud(host, ['workspace', 'gigs', ...words]);

    it('searches with the words as one query and prints the reply as JSON', async () => {
        expect(await gigs('search', 'landing', 'page', '--json')).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_gigs_finding',
                arguments: { action: 'search_gigs', query: 'landing page' },
            },
        ]);
        // The reply as the tool gave it: its content notice and trust labels stay for agents.
        expect(JSON.parse(stdout)).toEqual(reply('search_gigs', undefined));
    });

    it('searches without a query, and says when the results reach the limit', async () => {
        expect(await gigs('search', '--table')).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_gigs_finding', arguments: { action: 'search_gigs' } },
        ]);
        expect(stdout).toContain('Landing page');
        expect(stdout).toContain('$500.00');
        expect(stdout).toContain('Ada (@ada)');
        expect(stderr).toContain('Showing the first 1 matches');
    });

    it('shows one Gig, and exits 5 for one that is not there', async () => {
        expect(await gigs('get', GIG_ID, '--json')).toBe(0);
        expect(calls).toEqual([
            { name: 'dexto_gigs_finding', arguments: { action: 'get_gig', gigId: GIG_ID } },
        ]);
        expect(JSON.parse(stdout)).toMatchObject({ contentNotice: NOTICE, gig: { id: GIG_ID } });

        expect(await gigs('get', 'other', '--json')).toBe(5);
        expect(JSON.parse(stderr).error).toMatchObject({ code: 'not_found' });
    });

    it('lists the Gigs you posted and the proposals on one, from the posting tool', async () => {
        expect(await gigs('posted', '--json')).toBe(0);
        expect(JSON.parse(stdout).gigs[0]).toMatchObject({ id: GIG_ID, contentTrust: 'owner' });
        stdout = '';

        expect(await gigs('proposals', GIG_ID, '--table')).toBe(0);
        expect(stdout).toContain('bid-1');
        expect(stdout).toContain('¥1,200');
        expect(calls).toEqual([
            { name: 'dexto_gigs_posting', arguments: { action: 'list_posted_gigs' } },
            {
                name: 'dexto_gigs_posting',
                arguments: { action: 'list_gig_bids', gigId: GIG_ID },
            },
        ]);

        expect(await gigs('proposals', 'other', '--json')).toBe(5);
        expect(JSON.parse(stderr).error).toMatchObject({ code: 'not_found' });
    });

    it('lists the proposals you sent', async () => {
        expect(await gigs('bids', '--table')).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_gigs_finding', arguments: { action: 'list_my_bids' } },
        ]);
        expect(stdout).toContain('bid-2');
        expect(stdout).toContain('Landing page');
    });

    it('reads a thread, and exits 5 with no match or no thread', async () => {
        expect(await gigs('thread', GIG_ID, '--json')).toBe(0);
        expect(JSON.parse(stdout).thread.messages).toEqual([{ body: 'Hi', from: 'owner' }]);

        expect(await gigs('match', GIG_ID, '--json')).toBe(5);
        expect(await gigs('thread', 'other', '--json')).toBe(5);
        expect(calls.map((call) => call.arguments)).toEqual([
            { action: 'read_thread', gigId: GIG_ID },
            { action: 'get_match', gigId: GIG_ID },
            { action: 'read_thread', gigId: 'other' },
        ]);
    });

    it('needs gigs:read before calling, and names the sign-in that grants it', async () => {
        await signIn(['gigs:write']);

        expect(await gigs('search', '--json')).toBe(3);

        expect(calls).toEqual([]);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('needs_permission');
        expect(error.fix).toContain('gigs:read');
    });

    it("keeps the Cloud's refusals: a Gig the tool refuses as not found exits 5", async () => {
        refusal = { code: -32004, message: 'Gig not found.', data: { kind: 'not_found' } };

        expect(await gigs('proposals', GIG_ID, '--json')).toBe(5);

        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'Gig not found.',
        });
    });

    it("keeps the Cloud's scope refusal when the server asks for gigs:read", async () => {
        refusal = {
            code: -32003,
            message: 'Missing required scope: gigs:read.',
            data: { kind: 'forbidden', scope: 'gigs:read' },
        };

        expect(await gigs('bids', '--json')).toBe(3);

        expect(JSON.parse(stderr).error.fix).toContain('gigs:read');
    });
});
