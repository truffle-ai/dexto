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
const SITE = '11111111-1111-4111-8111-111111111111';
const RECORD = '22222222-2222-4222-8222-222222222222';
const meta = (level: string) => ({ 'dexto/app': 'sites', 'dexto/level': level });
const strict = { type: 'object', additionalProperties: false };

const TOOLS = [
    { name: 'dexto_site_collections_list', inputSchema: strict, _meta: meta('read') },
    { name: 'dexto_site_records_list', inputSchema: strict, _meta: meta('read') },
    { name: 'dexto_site_record_get', inputSchema: strict, _meta: meta('read') },
    { name: 'dexto_site_record_create', inputSchema: strict, _meta: meta('act') },
    { name: 'dexto_site_record_update', inputSchema: strict, _meta: meta('act') },
    { name: 'dexto_site_record_delete', inputSchema: strict, _meta: meta('act') },
];

const STORED = {
    collectionId: 'c1',
    createdAt: '2026-11-18T00:00:00.000Z',
    id: RECORD,
    siteId: SITE,
    updatedAt: '2026-11-18T00:00:00.000Z',
    value: { email: 'a@example.com' },
};

/** A managed collection as `dexto_site_collections_list` returns it. */
const SIGNUPS = {
    access: { create: 'public', delete: 'private', read: 'private', update: 'private' },
    createdAt: '2026-11-18T00:00:00.000Z',
    id: 'c1',
    name: 'signups',
    schema: {
        type: 'object',
        properties: { email: { type: 'string', format: 'email' } },
        required: ['email'],
        additionalProperties: false,
    },
    siteId: SITE,
    updatedAt: '2026-11-18T00:00:00.000Z',
};

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto workspace sites records', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let stdin: string;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let siteCollections: unknown[];
    let host: CloudHost;

    const signInWith = async (scopes: string[]) =>
        await dextoAccounts.writeLogin(dir, 'default', {
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

    /**
     * The JSON-RPC body the cloud answers with: the tool's result verbatim, or for a Site the person
     * can't see or a missing record the refusal the Site data tools declare, `unavailable` with
     * code -32004.
     */
    const answer = (id: number, name: string, args: Record<string, unknown>): unknown => {
        const refuse = (message: string) => ({
            jsonrpc: '2.0',
            id,
            error: {
                code: -32004,
                message,
                data: { kind: 'unavailable', retryable: false, resume: null },
            },
        });
        if (args.siteId !== SITE) return refuse('Site was not found.');
        if (args.recordId !== undefined && args.recordId !== RECORD)
            return refuse(`Site record ${String(args.recordId)} was not found.`);
        const where = { collection: args.collection, siteId: SITE, slug: 'shop' };
        const value = 'value' in args ? args.value : STORED.value;
        const structuredContent =
            name === 'dexto_site_collections_list'
                ? { collections: siteCollections, siteId: SITE, slug: 'shop' }
                : name === 'dexto_site_records_list'
                  ? { ...where, records: [STORED] }
                  : { ...where, record: { ...STORED, value } };
        return {
            jsonrpc: '2.0',
            id,
            result: {
                content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
                structuredContent,
            },
        };
    };

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-site-records-')), 'accounts');
        stdout = '';
        stderr = '';
        stdin = '';
        calls = [];
        siteCollections = [SIGNUPS];
        await signInWith(['sites:read', 'sites:write']);
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
                return Response.json(
                    answer(message.id, message.params.name, message.params.arguments)
                );
            },
            prompt: null,
            readStdin: async () => stdin,
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

    const records = (...args: string[]) =>
        runCloud(host, ['workspace', 'sites', 'records', ...args]);

    it('lists records with --limit and prints the tool result verbatim as JSON', async () => {
        expect(await records('list', SITE, 'signups', '--limit', '20', '--json')).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_site_records_list',
                arguments: { collection: 'signups', siteId: SITE, limit: 20 },
            },
        ]);
        expect(JSON.parse(stdout)).toEqual({
            collection: 'signups',
            records: [STORED],
            siteId: SITE,
            slug: 'shop',
        });
    });

    it("leaves the limit to the tool's default and prints a table at --table", async () => {
        expect(await records('list', SITE, 'signups', '--table')).toBe(0);

        expect(calls[0]?.arguments).toEqual({ collection: 'signups', siteId: SITE });
        expect(stdout).toContain(RECORD);
        expect(stdout).toContain('{"email":"a@example.com"}');
    });

    it('refuses a limit outside 1 to 100 and ids that are not UUIDs, before any call', async () => {
        expect(await records('list', SITE, 'signups', '--limit', '0')).toBe(2);
        expect(await records('list', SITE, 'signups', '--limit', '101')).toBe(2);
        expect(await records('list', 'shop', 'signups')).toBe(2);
        expect(await records('get', SITE, 'signups', 'r1')).toBe(2);
        expect(await records('list', SITE)).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it("gets one record, and fails with the tool's own message for one that is not there", async () => {
        expect(await records('get', SITE, 'signups', RECORD, '--json')).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_site_record_get',
                arguments: { collection: 'signups', recordId: RECORD, siteId: SITE },
            },
        ]);
        expect(JSON.parse(stdout).record).toEqual(STORED);

        stderr = '';
        const missing = '33333333-3333-4333-8333-333333333333';
        expect(await records('get', SITE, 'signups', missing, '--json')).toBe(1);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'failed',
            message: `Site record ${missing} was not found.`,
        });
    });

    it('creates a record only with --yes, sending the value as given', async () => {
        const args = ['create', SITE, 'signups', '--data', '{"email":"b@example.com"}', '--json'];

        expect(await records(...args)).toBe(4);
        expect(JSON.parse(stderr).error.fix).toContain('--yes');
        expect(calls).toHaveLength(0);

        expect(await records(...args, '--yes')).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_site_record_create',
                arguments: {
                    collection: 'signups',
                    siteId: SITE,
                    value: { email: 'b@example.com' },
                },
            },
        ]);
        expect(JSON.parse(stdout)).toMatchObject({
            collection: 'signups',
            record: { id: RECORD, value: { email: 'b@example.com' } },
        });
    });

    it('needs a value, as valid JSON, to create or update', async () => {
        expect(await records('create', SITE, 'signups', '--yes')).toBe(2);
        expect(await records('create', SITE, 'signups', '--data', '{nope', '--yes')).toBe(2);
        expect(await records('update', SITE, 'signups', RECORD, '--yes')).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it('replaces a record from stdin once agreed', async () => {
        stdin = '{"email":"c@example.com"}';
        const args = ['update', SITE, 'signups', RECORD, '--file', '-'];

        expect(await records(...args)).toBe(4);
        expect(calls).toHaveLength(0);

        expect(await records(...args, '--yes', '--table')).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_site_record_update',
                arguments: {
                    collection: 'signups',
                    recordId: RECORD,
                    siteId: SITE,
                    value: { email: 'c@example.com' },
                },
            },
        ]);
        expect(stdout).toBe(`Updated record ${RECORD}.\n`);
    });

    it('deletes a record once agreed, and shows a dry run without calling', async () => {
        expect(await records('delete', SITE, 'signups', RECORD, '--dry-run', '--json')).toBe(0);
        expect(calls).toHaveLength(0);
        expect(JSON.parse(stdout)).toEqual({
            dryRun: true,
            tool: 'dexto_site_record_delete',
            arguments: { collection: 'signups', recordId: RECORD, siteId: SITE },
        });

        stdout = '';
        expect(await records('delete', SITE, 'signups', RECORD)).toBe(4);
        expect(calls).toHaveLength(0);
        expect(await records('delete', SITE, 'signups', RECORD, '--yes', '--json')).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_site_record_delete',
                arguments: { collection: 'signups', recordId: RECORD, siteId: SITE },
            },
        ]);
        expect(JSON.parse(stdout).record.id).toBe(RECORD);
    });

    it('asks for sites:read to read and sites:write to change records', async () => {
        await signInWith(['apps:read']);
        expect(await records('list', SITE, 'signups', '--json')).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('sites:read');

        stderr = '';
        await signInWith(['sites:read']);
        expect(await records('get', SITE, 'signups', RECORD, '--json')).toBe(0);
        expect(await records('delete', SITE, 'signups', RECORD, '--yes', '--json')).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('sites:write');
        expect(calls.map((call) => call.name)).toEqual(['dexto_site_record_get']);
    });

    const collections = (...args: string[]) =>
        runCloud(host, ['workspace', 'sites', 'collections', ...args]);

    it("lists a Site's collections with their schemas and access policies as JSON", async () => {
        expect(await collections('list', SITE, '--json')).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_site_collections_list', arguments: { siteId: SITE } },
        ]);
        expect(JSON.parse(stdout)).toEqual({
            collections: [SIGNUPS],
            siteId: SITE,
            slug: 'shop',
        });
    });

    it('prints each collection with its access at --table, and an empty list as JSON', async () => {
        expect(await collections('list', SITE, '--table')).toBe(0);
        expect(stdout).toContain('signups');
        expect(stdout).toMatch(/signups\s+private\s+public\s+private\s+private/);

        stdout = '';
        siteCollections = [];
        expect(await collections('list', SITE, '--json')).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ collections: [], siteId: SITE, slug: 'shop' });
    });

    it('refuses a Site id that is not a UUID before any call', async () => {
        expect(await collections('list', 'shop')).toBe(2);
        expect(await collections('list')).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it("fails with the tool's own message for a Site the person can't see", async () => {
        const other = '44444444-4444-4444-8444-444444444444';
        expect(await collections('list', other, '--json')).toBe(1);
        expect(calls).toEqual([
            { name: 'dexto_site_collections_list', arguments: { siteId: other } },
        ]);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'failed',
            message: 'Site was not found.',
        });
    });

    it('asks for sites:read to list collections', async () => {
        await signInWith(['apps:read']);
        expect(await collections('list', SITE, '--json')).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('sites:read');
        expect(calls).toHaveLength(0);
    });
});
