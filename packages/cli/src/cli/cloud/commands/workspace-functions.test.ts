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
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};

const FUNCTION_ID = '2b4c6d8e-1f3a-4b5c-9d7e-0a1b2c3d4e5f';
const DEPLOYMENT_ID = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
const summary = {
    access: 'private',
    availability: 'ready',
    id: FUNCTION_ID,
    interfaces: { mcp: 'https://app.dexto.ai/fn/weather/mcp', openapi: null },
    invocation: {
        action: 'dexto_function_invoke',
        availability: 'available',
        requiredScope: 'functions:invoke',
    },
    kind: 'function',
    owned: true,
    operations: ['forecast'],
    slug: 'weather',
    title: 'Weather',
    url: 'https://app.dexto.ai/fn/weather',
};

/** One Dexto MCP reply: a tool's structured result, or a JSON-RPC refusal. */
type Reply = { result: unknown } | { error: { code: number; message: string; data?: unknown } };

describe('workspace functions over the Dexto MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: unknown }[];
    let replies: Reply[];
    let host: CloudHost;

    async function signIn(scopes: string[]) {
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
    }

    async function cli(...args: string[]): Promise<number> {
        return await runCloud(host, [...args, '--json']);
    }

    const output = () => JSON.parse(stdout);

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-functions-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        await signIn(['functions:read', 'functions:invoke']);
        const runtime: CloudRuntime = {
            color: false,
            environment: {},
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url !== MCP)
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                const message = await request.json();
                calls.push(message.params);
                const reply = replies.shift();
                if (reply === undefined) throw new Error('Unexpected MCP call');
                return Response.json(
                    'error' in reply
                        ? { jsonrpc: '2.0', id: message.id, error: reply.error }
                        : {
                              jsonrpc: '2.0',
                              id: message.id,
                              result: { content: [], structuredContent: reply.result },
                          }
                );
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
                    environment: runtime.environment,
                    overrides,
                    refresh: async (login: dextoAccounts.OAuthLogin) => login,
                }),
            signInForScopes: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('lists accessible Functions with their interfaces', async () => {
        replies = [{ result: { services: [summary] } }];
        expect(await cli('workspace', 'functions', 'list'), stderr).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_functions_list', arguments: {} }]);
        expect(output()).toEqual({ data: [summary] });

        stdout = '';
        replies = [{ result: { services: [] } }];
        expect(await cli('workspace', 'functions', 'list', '--limit', '50'), stderr).toBe(0);
        expect(calls[1]).toEqual({ name: 'dexto_functions_list', arguments: { limit: 50 } });
        expect(output()).toEqual({ data: [] });
    });

    it('reads an owned Function and its deployments', async () => {
        const owned = {
            deployments: [
                {
                    credentials: [],
                    createdAt: '2026-11-20T00:00:00.000Z',
                    id: DEPLOYMENT_ID,
                    publication: null,
                    provider: 'cloudflare',
                    status: 'ready',
                    updatedAt: '2026-11-20T00:01:00.000Z',
                },
            ],
            project: { ...summary },
        };
        replies = [{ result: owned }];
        expect(
            await cli('workspace', 'functions', 'get', FUNCTION_ID, '--deployments', '5'),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_function_get',
                arguments: { projectId: FUNCTION_ID, deploymentLimit: 5 },
            },
        ]);
        expect(output()).toEqual(owned);
    });

    it('reports a Function the sign-in cannot read as not found', async () => {
        replies = [
            {
                error: {
                    code: -32004,
                    message: 'Function was not found.',
                    data: { kind: 'not_found' },
                },
            },
        ];
        expect(await cli('workspace', 'functions', 'get', FUNCTION_ID)).toBe(5);
        expect(stderr).toContain('Function was not found.');
        expect(calls).toEqual([
            { name: 'dexto_function_get', arguments: { projectId: FUNCTION_ID } },
        ]);
    });

    it('asks before invoking, then passes the MCP input through', async () => {
        const invoke = ['workspace', 'functions', 'invoke', FUNCTION_ID, 'forecast'];
        expect(await cli(...invoke)).toBe(4);
        expect(calls).toEqual([]);

        const response = {
            body: { kind: 'json', value: { result: { content: [{ type: 'text', text: 'Sun' }] } } },
            byteCount: 52,
            headers: { 'content-type': 'application/json' },
            invocationId: 'inv-1',
            kind: 'response',
            status: 200,
            truncated: false,
        };
        replies = [{ result: response }];
        expect(
            await cli(
                ...invoke,
                '--data',
                '{"city":"Pune"}',
                '--deployment',
                DEPLOYMENT_ID,
                '--timeout',
                '5000',
                '--yes'
            ),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_function_invoke',
                arguments: {
                    projectId: FUNCTION_ID,
                    operation: 'forecast',
                    arguments: { city: 'Pune' },
                    deploymentId: DEPLOYMENT_ID,
                    timeoutMs: 5000,
                },
            },
        ]);
        expect(output()).toEqual(response);
    });

    it('fails on an inaccessible Function and on the proxy refusing the call', async () => {
        const invoke = ['workspace', 'functions', 'invoke', FUNCTION_ID, 'forecast', '--yes'];
        replies = [
            {
                result: {
                    error: {
                        code: 'not_found',
                        message: 'Managed service was not found.',
                        retryable: false,
                    },
                    invocationId: 'inv-2',
                    kind: 'error',
                },
            },
        ];
        expect(await cli(...invoke)).toBe(5);
        expect(stderr).toContain('Managed service was not found.');
        expect(stdout).toBe('');

        stderr = '';
        replies = [
            {
                result: {
                    error: {
                        code: 'provider_unavailable',
                        message: 'Managed service invocation is temporarily unavailable.',
                        retryable: true,
                    },
                    invocationId: 'inv-3',
                    kind: 'error',
                },
            },
        ];
        expect(await cli(...invoke)).toBe(1);
        expect(stderr).toContain('temporarily unavailable');
    });

    it('refuses unsupported inputs before or through the operation', async () => {
        const invoke = ['workspace', 'functions', 'invoke', FUNCTION_ID, 'forecast', '--yes'];
        expect(await cli(...invoke, '--data', '[1]')).toBe(2);
        expect(await cli(...invoke, '--timeout', '99')).toBe(2);
        expect(await cli(...invoke, '--timeout', '30001')).toBe(2);
        expect(await cli('workspace', 'functions', 'list', '--limit', '51')).toBe(2);
        expect(await cli('workspace', 'functions', 'get', FUNCTION_ID, '--deployments', '0')).toBe(
            2
        );
        expect(calls).toEqual([]);

        replies = [
            {
                error: {
                    code: -32602,
                    message: 'Invalid Function invocation input.',
                    data: { kind: 'invalid_arguments' },
                },
            },
        ];
        expect(
            await cli('workspace', 'functions', 'invoke', 'not-a-uuid', 'forecast', '--yes')
        ).toBe(2);
        expect(stderr).toContain('Invalid Function invocation input.');
        expect(calls).toEqual([
            {
                name: 'dexto_function_invoke',
                arguments: { projectId: 'not-a-uuid', operation: 'forecast' },
            },
        ]);
    });

    it('names the missing permission, before calling or from the refusal', async () => {
        await signIn(['functions:read']);
        expect(
            await cli('workspace', 'functions', 'invoke', FUNCTION_ID, 'forecast', '--yes')
        ).toBe(3);
        expect(stderr).toContain('--scope functions:invoke');
        await signIn(['functions:invoke']);
        expect(await cli('workspace', 'functions', 'list')).toBe(3);
        expect(stderr).toContain('--scope functions:read');
        expect(calls).toEqual([]);

        // A grant the sign-in names but the server no longer honours is refused there.
        await signIn(['functions:read']);
        stderr = '';
        replies = [
            {
                error: {
                    code: -32003,
                    message: 'Missing required scope: functions:read.',
                    data: { kind: 'forbidden', scope: 'functions:read' },
                },
            },
        ];
        expect(await cli('workspace', 'functions', 'get', FUNCTION_ID)).toBe(3);
        expect(stderr).toContain('functions:read');
    });
});
