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

const TOOLS = [
    {
        name: 'dexto_search',
        title: 'Search your workspace',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        _meta: { 'dexto/app': 'search', 'dexto/level': 'read' },
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

describe('dexto workspace', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { method: string; params: { name?: string; arguments?: unknown } }[];
    let authorization: (string | null)[];
    let environment: Record<string, string>;
    let host: CloudHost;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-ws-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        authorization = [];
        environment = {};
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
            scopes: ['cloud:read', 'email:send'],
            savedAt: '2026-11-01T00:00:00.000Z',
            signedInAs: null,
            cloudProject: null,
        });
        const runtime: CloudRuntime = {
            color: false,
            environment,
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url.endsWith('/.well-known/oauth-protected-resource/mcp'))
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                if (request.url !== MCP) return Response.json({}, { status: 404 });
                authorization.push(request.headers.get('authorization'));
                const message = JSON.parse(await request.text());
                calls.push({ method: message.method, params: message.params });
                const result =
                    message.method === 'tools/list'
                        ? { tools: TOOLS }
                        : {
                              content: [{ type: 'text', text: 'Sent.' }],
                              structuredContent: { status: 'sent' },
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
            commands: cloudCommands(dir),
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
});
