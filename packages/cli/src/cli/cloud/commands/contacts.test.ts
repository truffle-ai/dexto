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
const CONTACT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';

// The levels and confirm fields the cloud's Contacts operations declare.
const tool = (name: string, level: string) => ({
    name,
    inputSchema: {
        type: 'object',
        properties: level === 'approve' ? { confirm: { type: 'boolean' } } : {},
    },
    _meta: { 'dexto/app': 'contacts', 'dexto/level': level },
});
const TOOLS = [
    tool('dexto_contacts_people_list', 'read'),
    tool('dexto_contacts_people_search', 'read'),
    tool('dexto_contacts_requests_list', 'read'),
    tool('dexto_contacts_invite_link', 'read'),
    tool('dexto_contacts_connect', 'approve'),
    tool('dexto_contacts_request_answer', 'approve'),
    tool('dexto_contacts_remove', 'act'),
    tool('dexto_contacts_block', 'act'),
    tool('dexto_contacts_unblock', 'act'),
];

const PERSON = { handle: 'ada', name: 'Ada', organization: 'Acme', userId: USER };

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto workspace contacts', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let scopes: string[];
    let refusal: { code: number; message: string; data?: unknown } | null;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let host: CloudHost;

    const answer = (name: string, args: Record<string, unknown>): unknown => {
        if (name === 'dexto_contacts_people_list')
            return {
                people: [
                    {
                        ...PERSON,
                        contactId: CONTACT,
                        status: args.status === 'blocked' ? 'blocked' : 'connected',
                    },
                ],
            };
        if (name === 'dexto_contacts_people_search')
            return { people: [{ ...PERSON, organizationId: ORG }] };
        if (name === 'dexto_contacts_requests_list')
            return {
                requests: [
                    { ...PERSON, contactId: CONTACT, direction: 'incoming', organizationId: ORG },
                ],
            };
        if (name === 'dexto_contacts_invite_link') return { url: 'https://t.me/dexto?start=ada' };
        if (name === 'dexto_contacts_connect')
            return { contactId: CONTACT, status: 'requested', note: 'Request sent.' };
        if (name === 'dexto_contacts_request_answer')
            return {
                contactId: args.contactId,
                status: args.answer === 'accept' ? 'connected' : 'declined',
            };
        return {
            contactId: args.contactId,
            status: name === 'dexto_contacts_remove' ? 'removed' : name.slice(15) + 'ed',
        };
    };

    const run = (...args: string[]) => runCloud(host, ['workspace', 'contacts', ...args]);

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-contacts-')), 'accounts');
        stdout = '';
        stderr = '';
        scopes = ['contacts:read', 'contacts:write'];
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
                        result: { tools: TOOLS },
                    });
                calls.push({ name: message.params.name, arguments: message.params.arguments });
                if (refusal !== null)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: refusal });
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [{ type: 'text', text: 'ok' }],
                        structuredContent: answer(message.params.name, message.params.arguments),
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

    it('lists Contacts, filtered by --query, or the blocked ones with --blocked', async () => {
        await signIn();
        expect(await run('list', '--query', '@ad', '--json')).toBe(0);
        expect(JSON.parse(stdout)).toEqual({
            data: [{ ...PERSON, contactId: CONTACT, status: 'connected' }],
        });
        stdout = '';
        expect(await run('list', '--blocked')).toBe(0);
        expect(JSON.parse(stdout).data[0].status).toBe('blocked');

        expect(calls).toEqual([
            { name: 'dexto_contacts_people_list', arguments: { query: '@ad' } },
            { name: 'dexto_contacts_people_list', arguments: { status: 'blocked' } },
        ]);
    });

    it('searches people, requests and the invite link with their inputs', async () => {
        await signIn();
        expect(await run('search', 'ada')).toBe(0);
        expect(JSON.parse(stdout).data).toEqual([{ ...PERSON, organizationId: ORG }]);
        stdout = '';
        expect(await run('requests')).toBe(0);
        expect(JSON.parse(stdout).data[0]).toMatchObject({
            contactId: CONTACT,
            direction: 'incoming',
        });
        stdout = '';
        expect(await run('invite-link', '--json')).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ url: 'https://t.me/dexto?start=ada' });

        expect(calls).toEqual([
            { name: 'dexto_contacts_people_search', arguments: { query: 'ada' } },
            { name: 'dexto_contacts_requests_list', arguments: {} },
            { name: 'dexto_contacts_invite_link', arguments: {} },
        ]);
    });

    it('keeps the write permission on people search, as the operation asks', async () => {
        scopes = ['contacts:read'];
        await signIn();

        expect(await run('search', 'ada', '--json')).toBe(3);

        expect(JSON.parse(stderr).error.fix).toContain('contacts:write');
        expect(calls).toEqual([]);
    });

    it('asks for contacts:read before reading Contacts', async () => {
        scopes = [];
        await signIn();

        for (const verb of ['list', 'requests', 'invite-link']) {
            stderr = '';
            expect(await run(verb, '--json')).toBe(3);
            expect(JSON.parse(stderr).error.fix).toContain('contacts:read');
        }
        expect(calls).toEqual([]);
    });

    it('connects only with --yes when not at a terminal, confirming the approve call', async () => {
        await signIn();
        const args = ['connect', '@ada', '--user', USER, '--organization', ORG];

        expect(await run(...args, '--json')).toBe(4);
        expect(JSON.parse(stderr).error.code).toBe('needs_confirmation');
        expect(calls).toEqual([]);

        expect(await run(...args, '--yes', '--json')).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_contacts_connect',
                arguments: { handle: '@ada', organizationId: ORG, userId: USER, confirm: true },
            },
        ]);
        expect(JSON.parse(stdout)).toMatchObject({ contactId: CONTACT, status: 'requested' });
    });

    it('needs --user and --organization to connect', async () => {
        await signIn();

        expect(await run('connect', 'ada', '--user', USER, '--yes', '--json')).toBe(2);
        expect(JSON.parse(stderr).error.message).toContain('--organization');
        expect(calls).toEqual([]);
    });

    it('answers a request as accept or decline, with confirm', async () => {
        await signIn();
        expect(await run('accept', CONTACT)).toBe(4);
        expect(calls).toEqual([]);

        expect(await run('accept', CONTACT, '--yes')).toBe(0);
        expect(await run('decline', CONTACT, '--yes')).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_contacts_request_answer',
                arguments: { answer: 'accept', contactId: CONTACT, confirm: true },
            },
            {
                name: 'dexto_contacts_request_answer',
                arguments: { answer: 'decline', contactId: CONTACT, confirm: true },
            },
        ]);
    });

    it('removes, blocks and unblocks by contact id once agreed, with no confirm field', async () => {
        await signIn();
        for (const verb of ['remove', 'block', 'unblock']) {
            expect(await run(verb, CONTACT)).toBe(4);
        }
        expect(calls).toEqual([]);

        for (const verb of ['remove', 'block', 'unblock']) {
            stdout = '';
            expect(await run(verb, CONTACT, '--yes')).toBe(0);
            expect(JSON.parse(stdout).contactId).toBe(CONTACT);
        }
        expect(calls).toEqual([
            { name: 'dexto_contacts_remove', arguments: { contactId: CONTACT } },
            { name: 'dexto_contacts_block', arguments: { contactId: CONTACT } },
            { name: 'dexto_contacts_unblock', arguments: { contactId: CONTACT } },
        ]);
    });

    it("exits 5 when Dexto has no such contact, with Dexto's words", async () => {
        await signIn();
        refusal = {
            code: -32004,
            message: 'No connection or request has that contactId.',
            data: { kind: 'not_found' },
        };

        expect(await run('block', CONTACT, '--yes', '--json')).toBe(5);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'No connection or request has that contactId.',
        });
    });

    it('needs a personal sign-in, not an API key', async () => {
        expect(await run('list', '--api-key', 'dxt_test', '--json')).not.toBe(0);
        expect(calls).toEqual([]);
        expect(JSON.parse(stderr).error.code).toBe('needs_sign_in');
    });
});
