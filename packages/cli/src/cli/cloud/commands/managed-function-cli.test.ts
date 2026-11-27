import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const signIn = async (): Promise<never> => {
    throw new Error('Unexpected sign-in');
};
let dir: string;
let stdout: string;
let stderr: string;
let calls: { name: string; arguments: Record<string, unknown> }[];
let host: CloudHost;

beforeEach(async () => {
    dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'function-cli-')), 'accounts');
    stdout = '';
    stderr = '';
    calls = [];
    await dextoAccounts.writeLogin(dir, 'default', {
        kind: 'oauth',
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: 'https://app.dexto.ai',
        apiBaseUrl: 'https://api.dexto.ai',
        resource: MCP,
        tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        scopes: ['functions:read', 'functions:write'],
        savedAt: '2026-11-01T00:00:00.000Z',
        signedInAs: null,
        cloudProject: null,
    });
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
                    result: {
                        tools: [
                            {
                                name: 'dexto_function_credential_configure',
                                _meta: { 'dexto/level': 'approve' },
                                inputSchema: { type: 'object', properties: { confirm: {} } },
                            },
                            {
                                name: 'dexto_function_secret_delete',
                                _meta: { 'dexto/level': 'act' },
                                inputSchema: { type: 'object', properties: {} },
                            },
                        ],
                    },
                });
            calls.push({ name: message.params.name, arguments: message.params.arguments });
            if (
                message.params.name === 'dexto_function_credential_configure' &&
                message.params.arguments.credential.kind === 'dexto-api-key'
            )
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32602,
                        message:
                            "Reconnect Dexto MCP with the deployment's required scopes: sites:read, chats:write.",
                        data: { kind: 'invalid_arguments' },
                    },
                });
            if (message.params.arguments.provider === 'aws-lambda')
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32003,
                        message: 'Missing required scope: functions:read',
                        data: { kind: 'forbidden', scope: 'functions:read' },
                    },
                });
            if (message.params.name === 'dexto_function_secret_delete')
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32004,
                        message: 'Function secret was not found.',
                        data: { kind: 'not_found', retryable: false, resume: null },
                    },
                });
            const value =
                message.params.name === 'dexto_function_plan'
                    ? { default: 'local', providers: ['local'] }
                    : { status: 'needs_input', url: 'https://app.dexto.ai/secure' };
            return Response.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                    content: [{ type: 'text', text: JSON.stringify(value) }],
                    structuredContent: value,
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
        commands: cloudCommands(dir, signIn),
        signIn,
        groups: CLOUD_GROUPS,
        runtime,
        resolveConnection: (overrides) =>
            resolveConnection({ dir, environment, overrides, refresh: async (login) => login }),
        signInForScopes: async () => false,
    };
});
afterEach(async () => {
    await rm(path.dirname(dir), { recursive: true, force: true });
});

it('dispatches plan through the CLI and emits the tool result as JSON', async () => {
    expect(
        await runCloud(host, ['workspace', 'functions', 'plan', '--provider', 'local', '--json'])
    ).toBe(0);
    expect(calls).toEqual([{ name: 'dexto_function_plan', arguments: { provider: 'local' } }]);
    expect(JSON.parse(stdout)).toEqual({ default: 'local', providers: ['local'] });
});

it('prints the secure credential URL as JSON', async () => {
    expect(
        await runCloud(host, [
            'workspace',
            'functions',
            'credential',
            'configure',
            'project',
            'deployment',
            '--kind',
            'declared-secret',
            '--name',
            'API_KEY',
            '--yes',
            '--json',
        ])
    ).toBe(0);
    expect(calls).toEqual([
        {
            name: 'dexto_function_credential_configure',
            arguments: {
                projectId: 'project',
                deploymentId: 'deployment',
                credential: { kind: 'declared-secret', name: 'API_KEY' },
                confirm: true,
            },
        },
    ]);
    expect(JSON.parse(stdout)).toEqual({
        status: 'needs_input',
        url: 'https://app.dexto.ai/secure',
    });
});

it('returns a machine-readable error for a server refusal', async () => {
    expect(
        await runCloud(host, [
            'workspace',
            'functions',
            'secret',
            'delete',
            'project',
            'MISSING',
            '--yes',
            '--json',
        ])
    ).toBe(5);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(stderr)).toMatchObject({
        error: { code: 'not_found', message: 'Function secret was not found.' },
    });
});

it('reports a missing scope refused by the server as a permission error', async () => {
    expect(
        await runCloud(host, [
            'workspace',
            'functions',
            'plan',
            '--provider',
            'aws-lambda',
            '--json',
        ])
    ).toBe(3);
    expect(JSON.parse(stderr)).toMatchObject({
        error: { code: 'needs_permission', message: expect.stringContaining('functions:read') },
    });
});

it('reports missing deployment-key scopes with a command to grant all of them', async () => {
    expect(
        await runCloud(host, [
            'workspace',
            'functions',
            'credential',
            'configure',
            'project',
            'deployment',
            '--kind',
            'dexto-api-key',
            '--yes',
            '--json',
        ])
    ).toBe(3);
    expect(JSON.parse(stderr)).toMatchObject({
        error: {
            code: 'needs_permission',
            fix: expect.stringContaining('--scope sites:read --scope chats:write'),
        },
    });
});
