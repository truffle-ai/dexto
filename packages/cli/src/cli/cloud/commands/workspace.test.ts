import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';

const TOOLS = [
    {
        name: 'dexto_search',
        title: 'Search your workspace',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        _meta: { 'dexto/app': 'search', 'dexto/level': 'read' },
    },
    {
        name: 'dexto_site_publish',
        title: 'Publish a link',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' }, confirm: { type: 'boolean' } },
        },
        _meta: { 'dexto/app': 'sites', 'dexto/level': 'act' },
    },
    {
        name: 'dexto_email_send',
        title: 'Send an email',
        inputSchema: {
            type: 'object',
            properties: { to: { type: 'string' }, confirm: { type: 'boolean' } },
        },
        _meta: { 'dexto/app': 'email', 'dexto/level': 'act' },
    },
];

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a key or a saved login.');
};

describe('dexto workspace', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { method: string; params: { name?: string; arguments?: unknown } }[];
    let authorization: (string | null)[];
    let environment: Record<string, string>;
    let uploads: { url: string; method: string; bytes: Uint8Array }[];
    let host: CloudHost;
    let publishResponse: unknown;
    let publishProject: string | null;
    let publishStatus: number;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-ws-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        authorization = [];
        environment = {};
        uploads = [];
        publishResponse = undefined;
        publishStatus = 200;
        publishProject = null;
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
            scopes: ['cloud:read', 'cloud:write', 'email:send', 'sites:write'],
            savedAt: '2026-11-01T00:00:00.000Z',
            signedInAs: null,
            cloudProject: { id: 'project-1', name: 'Main' },
        });
        const runtime: CloudRuntime = {
            color: false,
            environment,
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url.endsWith('/.well-known/oauth-protected-resource/mcp'))
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                if (request.url.startsWith('https://upload.example/')) {
                    uploads.push({
                        url: request.url,
                        method: request.method,
                        bytes: new Uint8Array(await request.arrayBuffer()),
                    });
                    return new Response(null, { status: 200 });
                }
                if (request.url === 'https://api.dexto.ai/v1/sites/publish') {
                    const body: unknown = await request.json();
                    publishProject = request.headers.get('dexto-cloud-project');
                    calls.push({
                        method: 'POST',
                        params: { name: 'POST /v1/sites/publish', arguments: body },
                    });
                    const visibility =
                        typeof body === 'object' && body !== null && 'visibility' in body
                            ? body.visibility
                            : 'unlisted';
                    return Response.json(
                        publishResponse ?? {
                            created: true,
                            files: 2,
                            homepage: 'index.html',
                            site: { id: 'site-1', slug: 'hello', title: 'Hello' },
                            url: 'https://hello.dexto.page',
                            visibility,
                        },
                        { status: publishStatus }
                    );
                }
                if (request.url !== MCP) return Response.json({}, { status: 404 });
                authorization.push(request.headers.get('authorization'));
                const message = JSON.parse(await request.text());
                calls.push({ method: message.method, params: message.params });
                const tool = message.params?.name;
                const structured =
                    tool === 'dexto_upload_prepare'
                        ? {
                              url: 'https://upload.example/u1',
                              method: 'PUT',
                              headers: {},
                              path: 'uploads/u1.zip',
                          }
                        : { status: 'sent' };
                const result =
                    message.method === 'tools/list'
                        ? { tools: TOOLS }
                        : {
                              content: [{ type: 'text', text: 'ok' }],
                              structuredContent: structured,
                          };
                return Response.json({ jsonrpc: '2.0', id: message.id, result });
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
            signInForScope: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it("lists the workspace's apps, from the tools the Dexto MCP lists", async () => {
        expect(await runCloud(host, ['workspace'])).toBe(0);

        expect(JSON.parse(stdout).apps.map((app: { id: string }) => app.id)).toEqual([
            'email',
            'search',
            'sites',
        ]);
        expect(authorization[0]).toBe('Bearer access-1');
    });

    it('lists the tools with workspace tools', async () => {
        await runCloud(host, ['workspace', 'tools', '--search', 'email']);

        expect(JSON.parse(stdout).data.map((tool: { name: string }) => tool.name)).toEqual([
            'dexto_email_send',
        ]);
    });

    it('asks before a call that acts, and passes confirm once agreed', async () => {
        const args = ['workspace', 'call', 'dexto_email_send', '--data', '{"to":"a@b.c"}'];

        expect(await runCloud(host, args)).toBe(4);
        expect(calls.some((call) => call.method === 'tools/call')).toBe(false);
        expect(JSON.parse(stderr).error.fix).toBe(
            `dexto workspace call dexto_email_send --data '{"to":"a@b.c"}' --yes`
        );

        expect(await runCloud(host, [...args, '--yes'])).toBe(0);
        expect(calls.at(-1)).toEqual({
            method: 'tools/call',
            params: { name: 'dexto_email_send', arguments: { to: 'a@b.c', confirm: true } },
        });
        expect(JSON.parse(stdout.slice(stdout.indexOf('{')))).toEqual({ status: 'sent' });
    });

    it('acts as a person only: an API key is told to sign in', async () => {
        environment.DEXTO_API_KEY = 'dxt_key';

        expect(await runCloud(host, ['workspace', 'tools'])).toBe(3);
        expect(JSON.parse(stderr).error.message).toContain("an API key can't use them");
        expect(calls).toHaveLength(0);
    });

    it('runs an app operation as dexto workspace <app> <operation> --field value', async () => {
        const code = await runCloud(host, ['workspace', 'email', 'send', '--to', 'a@b.c', '--yes']);

        expect(code).toBe(0);
        expect(calls.at(-1)).toEqual({
            method: 'tools/call',
            params: { name: 'dexto_email_send', arguments: { to: 'a@b.c', confirm: true } },
        });
    });

    it('answers an app it does not have with exit 2', async () => {
        expect(await runCloud(host, ['workspace', 'nope'])).toBe(2);
    });

    it('rejects invalid visibility before uploading', async () => {
        expect(
            await runCloud(host, ['publish', 'anything', '--visibility', 'team', '--yes', '--json'])
        ).toBe(2);
        expect(JSON.parse(stderr).error.message).toContain('--visibility');
        expect(uploads).toHaveLength(0);
        expect(calls).toHaveLength(0);
    });

    it('requires gateway access before uploading a Site', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, scopes: ['sites:write'] });
        expect(await runCloud(host, ['publish', 'anything', '--yes', '--json'])).toBe(3);
        expect(JSON.parse(stderr).error.message).toContain('cloud:write');
        expect(uploads).toHaveLength(0);
    });

    it('asks for both missing permissions before uploading', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, scopes: [] });
        expect(await runCloud(host, ['publish', 'anything', '--yes', '--json'])).toBe(3);
        const error = JSON.parse(stderr).error;
        expect(error.message).toContain('cloud:write');
        expect(error.message).toContain('sites:write');
        expect(uploads).toHaveLength(0);
    });

    it('requests both permissions in one interactive sign-in', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, scopes: [] });
        const granted: string[] = [];
        host = {
            ...host,
            runtime: { ...host.runtime, prompt: async () => 'yes', stdoutIsTerminal: true },
            signInForScope: async (_overrides, scopes) => {
                granted.push(scopes);
                await dextoAccounts.writeLogin(dir, 'default', {
                    ...login,
                    scopes: ['sites:write', 'cloud:write'],
                });
                return true;
            },
        };
        const file = path.join(path.dirname(dir), 'interactive.html');
        await writeFile(file, '<h1>hello</h1>');
        expect(await runCloud(host, ['publish', file, '--yes', '--table'])).toBe(0);
        expect(granted).toEqual(['sites:write,cloud:write']);
    });

    it('creates a public Site without an extra confirmation flag', async () => {
        const file = path.join(path.dirname(dir), 'public.html');
        await writeFile(file, '<h1>public</h1>');
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'public', '--yes', '--json'])
        ).toBe(0);
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('confirmPublicName');
        expect(JSON.parse(stdout).visibility).toBe('public');
    });

    it('reports the exact confirmation needed for an existing private Site', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        publishStatus = 409;
        publishResponse = {
            error: {
                code: 'needs_confirmation',
                message: 'Confirm the Site name "Team plan" before making it public.',
            },
        };
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'public', '--yes', '--json'])
        ).toBe(4);
        expect(JSON.parse(stderr).error.message).toContain('--confirm-public');
        expect(JSON.parse(stderr).error.message).toContain('Team plan');
        expect(calls.at(-1)?.params.name).toBe('POST /v1/sites/publish');
        expect(stdout).toBe('');
        stderr = '';
        expect(
            await runCloud(host, [
                'publish',
                file,
                '--visibility',
                'public',
                '--confirm-public',
                'Wrong',
                '--yes',
                '--json',
            ])
        ).toBe(4);
        expect(calls.at(-1)?.params.arguments).toMatchObject({ confirmPublicName: 'Wrong' });
        expect(JSON.parse(stderr).error.message).toContain('Team plan');
        expect(stdout).toBe('');
    });

    it('sends the explicit Site name to confirm a private-to-public change', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        expect(
            await runCloud(host, [
                'publish',
                file,
                '--visibility',
                'public',
                '--confirm-public',
                'Team plan',
                '--yes',
                '--json',
            ])
        ).toBe(0);
        expect(calls.at(-1)?.params.arguments).toMatchObject({
            visibility: 'public',
            confirmPublicName: 'Team plan',
        });
    });

    it('requires a Cloud project before uploading', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, cloudProject: null });
        expect(await runCloud(host, ['publish', 'anything', '--yes', '--json'])).toBe(2);
        expect(JSON.parse(stderr).error.message).toContain('--project');
        expect(uploads).toHaveLength(0);
    });

    it('refuses malformed or mismatched publish results', async () => {
        const file = path.join(path.dirname(dir), 'page.html');
        await writeFile(file, '<h1>private</h1>');
        publishResponse = { created: true };
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--json'])
        ).not.toBe(0);
        expect(stdout).toBe('');
        stderr = '';
        publishResponse = {
            created: false,
            files: 1,
            homepage: 'index.html',
            site: { id: 'site-1', slug: 'page', title: 'Page' },
            url: 'https://page.example',
            visibility: 'public',
        };
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--json'])
        ).not.toBe(0);
        expect(stdout).toBe('');
    });

    it('keeps omitted visibility omitted and sends the selected project', async () => {
        const file = path.join(path.dirname(dir), 'page.html');
        await writeFile(file, '<h1>update</h1>');
        expect(await runCloud(host, ['publish', file, '--yes', '--json'])).toBe(0);
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('visibility');
        expect(publishProject).toBe('project-1');
        expect(calls.some((call) => call.method === 'tools/list')).toBe(false);
    });

    it('explains the default visibility before asking for publish consent', async () => {
        const file = path.join(path.dirname(dir), 'consent.html');
        await writeFile(file, '<h1>Consent</h1>');
        const questions: string[] = [];
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                prompt: async (question) => {
                    questions.push(question);
                    return 'yes';
                },
            },
        };
        expect(await runCloud(host, ['publish', file, '--json'])).toBe(0);
        expect(questions).toHaveLength(1);
        expect(questions[0]).toContain('new Site is unlisted');
        expect(questions[0]).toContain('anyone with the link can open it');
        expect(questions[0]).toContain('existing Site keeps its visibility');
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('visibility');
    });

    it('passes private visibility to the Site publish operation', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--json'])
        ).toBe(0);
        expect(calls.at(-1)?.params.arguments).toMatchObject({ visibility: 'private' });
        expect(stdout).not.toContain('Anyone with the link can open it');
        expect(JSON.parse(stdout).visibility).toBe('private');
    });

    it('describes a private Site correctly in human output', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--table'])
        ).toBe(0);
        expect(stdout).not.toContain('Anyone with the link can open it');
        expect(stdout).toContain('Open it from Dexto as an organization member.');
    });

    it('publishes a folder as a zip, uploaded where Dexto says, once agreed', async () => {
        const folder = path.join(path.dirname(dir), 'hello');
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, 'index.html'), '<h1>hi</h1>');
        await writeFile(path.join(folder, 'style.css'), 'h1{}');
        await writeFile(path.join(folder, '.secret'), 'left out');

        expect(await runCloud(host, ['publish', folder])).toBe(4);
        expect(uploads).toHaveLength(0);

        const code = await runCloud(host, ['publish', folder, '--yes', '--table']);

        expect(code).toBe(0);
        expect(uploads).toHaveLength(1);
        expect(uploads[0]?.method).toBe('PUT');
        expect(new globalThis.TextDecoder().decode(uploads[0]?.bytes.slice(0, 2))).toBe('PK');
        expect(calls.at(-1)).toEqual({
            method: 'POST',
            params: {
                name: 'POST /v1/sites/publish',
                arguments: { name: 'hello', uploadPath: 'uploads/u1.zip' },
            },
        });
        expect(stdout).toContain(
            'Published hello at https://hello.dexto.page (2 files). Anyone with the link can open it.'
        );
    });
});
