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

const KEY_ID = '7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const key = {
    id: KEY_ID,
    name: 'ci',
    services: ['computer'],
    enrolledComputers: 0,
    maxComputers: 3,
    expiresAt: '2026-11-11T00:00:00.000Z',
    status: 'active',
    createdAt: '2026-11-10T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
};

describe('computer enrollment keys over the Dexto MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: unknown }[];
    let replies: unknown[];
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
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-computer-keys-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        await signIn(['computers:read', 'computers:write']);
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
                const value = replies.shift();
                if (value === undefined) throw new Error('Unexpected MCP call');
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: { content: [], structuredContent: value },
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
                    environment: runtime.environment,
                    overrides,
                    refresh: async (login: dextoAccounts.OAuthLogin) => login,
                }),
            signInForScope: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('lists keys', async () => {
        replies = [{ keys: [key] }];
        expect(await cli('workspace', 'computers', 'keys', 'list'), stderr).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_computer_enrollment_keys_list', arguments: {} }]);
        expect(output()).toEqual({ data: [key] });
    });

    it('asks before creating a key, then returns its one-time secret', async () => {
        expect(await cli('workspace', 'computers', 'keys', 'create', 'ci')).toBe(4);
        expect(calls).toEqual([]);
        const created = {
            status: 'created',
            enrollmentKey: 'dek_secret',
            connectCommand: 'dexto-daemon connect --key dek_secret',
            key,
        };
        replies = [created];
        expect(
            await cli(
                'workspace',
                'computers',
                'keys',
                'create',
                'ci',
                '--service',
                'computer',
                '--max-computers',
                '3',
                '--expires-in',
                '1440',
                '--yes'
            ),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_computer_enrollment_key_create',
            arguments: {
                name: 'ci',
                services: ['computer'],
                maxComputers: 3,
                expiresInMinutes: 1440,
            },
        });
        expect(output()).toEqual(created);
    });

    it('checks services, limits and the sign-in permission before calling', async () => {
        const create = ['workspace', 'computers', 'keys', 'create', 'ci', '--yes'];
        expect(await cli(...create, '--service', 'gpu')).toBe(2);
        expect(await cli(...create, '--max-computers', '101')).toBe(2);
        expect(await cli(...create, '--expires-in', '4')).toBe(2);
        await signIn(['computers:read']);
        expect(await cli(...create)).toBe(3);
        expect(stderr).toContain('--scope computers:write');
        expect(calls).toEqual([]);
    });

    it('revokes a key once agreed', async () => {
        expect(await cli('workspace', 'computers', 'keys', 'revoke', KEY_ID)).toBe(4);
        replies = [{ status: 'revoked', key: { ...key, status: 'revoked' } }];
        expect(await cli('workspace', 'computers', 'keys', 'revoke', KEY_ID, '--yes'), stderr).toBe(
            0
        );
        expect(calls).toEqual([
            { name: 'dexto_computer_enrollment_key_revoke', arguments: { keyId: KEY_ID } },
        ]);
    });
});
