import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { builtCloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const TOOL = 'dexto_computer_port_link';
const COMPUTER = '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80';
const ORG_LINK = {
    expiresAt: null,
    port: 3000,
    url: 'https://p-3000-abc.dexto.site/',
    visibility: 'organization',
};
const PUBLIC_LINK = {
    expiresAt: '2026-11-23T14:00:00.000Z',
    port: 8080,
    url: 'https://p-8080-abc.dexto.site/',
    visibility: 'public',
};
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};

describe('dexto computer url', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let host: CloudHost;
    let calls: { name: string; arguments: unknown }[];
    let replies: unknown[];
    let rpcError: unknown;
    let stdoutIsTerminal: boolean;

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

    const cli = (...words: string[]) => runCloud(host, ['computer', 'url', ...words]);

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-computer-url-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        rpcError = null;
        stdoutIsTerminal = false;
        await signIn(['cloud:read', 'computers:read', 'computers:write']);
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
                if (rpcError !== null)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: rpcError });
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
            get stdoutIsTerminal() {
                return stdoutIsTerminal;
            },
            writeBytes: async () => undefined,
            writeError: (text) => {
                stderr += text;
            },
            writeOutput: (text) => {
                stdout += text;
            },
        };
        host = {
            commands: builtCloudCommands(dir, unusedSignIn),
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

    it('asks before sharing a port with the organization, then prints the link as JSON', async () => {
        expect(await cli(COMPUTER, '3000', '--json')).toBe(4);
        expect(calls).toEqual([]);
        replies = [ORG_LINK];
        expect(await cli(COMPUTER, '3000', '--yes', '--json'), stderr).toBe(0);
        expect(calls).toEqual([
            {
                name: TOOL,
                arguments: { action: 'share', computerId: COMPUTER, port: 3000, confirm: true },
            },
        ]);
        expect(JSON.parse(stdout)).toEqual(ORG_LINK);
    });

    it('publishes a public link that closes after --expires-in-hours', async () => {
        replies = [PUBLIC_LINK];
        expect(
            await cli(COMPUTER, '8080', '--public', '--expires-in-hours', '2', '--yes', '--json'),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: TOOL,
            arguments: {
                action: 'publish',
                computerId: COMPUTER,
                port: 8080,
                expiresInHours: 2,
                confirm: true,
            },
        });
        expect(JSON.parse(stdout)).toEqual(PUBLIC_LINK);
    });

    it('tells people the link and who can open it', async () => {
        stdoutIsTerminal = true;
        replies = [PUBLIC_LINK];
        expect(await cli(COMPUTER, '8080', '--public', '--yes'), stderr).toBe(0);
        expect(stdout).toContain(PUBLIC_LINK.url);
        expect(stdout).toContain('Anyone with the link can open it');
        expect(stdout).toContain(PUBLIC_LINK.expiresAt);
    });

    it('shows the call --dry-run would make without making it', async () => {
        expect(
            await cli(COMPUTER, '3000', '--expires-in-hours', '5', '--dry-run', '--json'),
            stderr
        ).toBe(0);
        expect(calls).toEqual([]);
        expect(JSON.parse(stdout)).toEqual({
            dryRun: true,
            tool: TOOL,
            arguments: { action: 'share', computerId: COMPUTER, port: 3000, expiresInHours: 5 },
        });
    });

    it.each([['0'], ['65536'], ['3000.5'], ['web']])(
        'refuses port %s before any call',
        async (port) => {
            expect(await cli(COMPUTER, port, '--yes', '--json')).toBe(2);
            expect(calls).toEqual([]);
        }
    );

    it.each([['0'], ['721']])('refuses --expires-in-hours %s before any call', async (hours) => {
        expect(await cli(COMPUTER, '3000', '--expires-in-hours', hours, '--yes', '--json')).toBe(2);
        expect(calls).toEqual([]);
    });

    it('needs a computer id and a port', async () => {
        expect(await cli('--json')).toBe(2);
        expect(await cli(COMPUTER, '--json')).toBe(2);
        expect(calls).toEqual([]);
    });

    it('lists the open links without asking', async () => {
        replies = [{ links: [ORG_LINK, PUBLIC_LINK] }];
        expect(await cli('list', COMPUTER, '--json'), stderr).toBe(0);
        expect(calls).toEqual([
            { name: TOOL, arguments: { action: 'list', computerId: COMPUTER } },
        ]);
        expect(JSON.parse(stdout)).toEqual({ links: [ORG_LINK, PUBLIC_LINK] });
    });

    it('shows people each open link, or that there are none', async () => {
        stdoutIsTerminal = true;
        replies = [{ links: [ORG_LINK] }, { links: [] }];
        expect(await cli('list', COMPUTER), stderr).toBe(0);
        expect(stdout).toContain(ORG_LINK.url);
        expect(stdout).toContain('Members of your organization open it after signing in');
        stdout = '';
        expect(await cli('list', COMPUTER), stderr).toBe(0);
        expect(stdout).toContain('No open links.');
    });

    it('asks before closing a port link, and --dry-run closes nothing', async () => {
        expect(await cli('revoke', COMPUTER, '3000', '--json')).toBe(4);
        expect(await cli('revoke', COMPUTER, '3000', '--dry-run', '--json')).toBe(0);
        expect(calls).toEqual([]);
        expect(JSON.parse(stdout)).toEqual({
            dryRun: true,
            tool: TOOL,
            arguments: { action: 'revoke', computerId: COMPUTER, port: 3000 },
        });
        stdout = '';
        replies = [{ port: 3000, status: 'revoked' }];
        expect(await cli('revoke', COMPUTER, '3000', '--yes', '--json'), stderr).toBe(0);
        expect(calls).toEqual([
            {
                name: TOOL,
                arguments: { action: 'revoke', computerId: COMPUTER, port: 3000, confirm: true },
            },
        ]);
        expect(JSON.parse(stdout)).toEqual({ port: 3000, status: 'revoked' });
    });

    it('reports a computer or link the server does not find as not_found', async () => {
        rpcError = {
            code: -32004,
            message: 'Computer not found.',
            data: { kind: 'not_found', retryable: false },
        };
        expect(await cli('revoke', COMPUTER, '3000', '--yes', '--json')).toBe(5);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'Computer not found.',
        });
    });

    it('reports public links turned off for the organization as needs_permission', async () => {
        rpcError = {
            code: -32003,
            message: 'This organization has turned public links off.',
            data: { kind: 'forbidden', retryable: false },
        };
        expect(await cli(COMPUTER, '3000', '--public', '--yes', '--json')).toBe(3);
        expect(JSON.parse(stderr).error).toMatchObject({ code: 'needs_permission' });
    });

    it('asks a sign-in without the computer scope to sign in again for it', async () => {
        await signIn(['cloud:read']);
        expect(await cli(COMPUTER, '3000', '--yes', '--json')).toBe(3);
        expect(JSON.parse(stderr).error.fix).toMatch(/--scope computers:write$/);
        stderr = '';
        expect(await cli('list', COMPUTER, '--json')).toBe(3);
        expect(JSON.parse(stderr).error.fix).toMatch(/--scope computers:read$/);
        expect(calls).toEqual([]);
    });
});
