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
    throw new Error('Unexpected sign-in');
};
const base = [
    'workspace',
    'mcp-servers',
    'import',
    '--source-agent',
    'codex',
    '--source-id',
    'source-1',
    '--importer-version',
    '1',
    '--name',
    'Example',
    '--auth',
    'oauth',
    '--endpoint',
    'https://example.com/mcp',
];

describe('remote MCP server import', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: unknown[];
    let reply: unknown;
    let refusal: unknown;
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

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-mcp-import-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        reply = undefined;
        refusal = undefined;
        await signIn(['connectors:import']);
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
                if (refusal !== undefined)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: refusal });
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: { content: [], structuredContent: reply },
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
            signInForScopes: async () => false,
        };
    });
    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('submits the selected OAuth server after consent and returns the handoff as JSON', async () => {
        reply = {
            status: 'imported',
            connectorId: 'connector-1',
            connectorSlug: 'example',
            importProvenance: {},
            next: 'authorize',
            connectUrl: 'https://app.dexto.ai/settings/connections',
        };
        expect(await runCloud(host, [...base, '--yes', '--json']), stderr).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_mcp_server_import',
                arguments: {
                    sourceAgent: 'codex',
                    sourceId: 'source-1',
                    importerVersion: '1',
                    name: 'Example',
                    server: { kind: 'oauth', endpoint: 'https://example.com/mcp' },
                    confirm: true,
                },
            },
        ]);
        expect(JSON.parse(stdout)).toEqual(reply);
    });

    it('submits Vault placement and provenance without a credential value', async () => {
        reply = {
            status: 'already_imported',
            connectorId: 'connector-1',
            connectorSlug: 'example',
            importProvenance: {},
            next: 'connect',
            connectUrl: 'https://app.dexto.ai/settings/connections',
        };
        const args = [...base];
        args[args.indexOf('oauth')] = 'static';
        expect(
            await runCloud(host, [
                ...args,
                '--header-name',
                'X-API-Key',
                '--scheme',
                'raw',
                '--vault-ref',
                'vault:12345678-1234-1234-1234-123456789abc',
                '--source-path',
                '/project/config',
                '--source-created-at',
                '2026-01-01T00:00:00Z',
                '--source-updated-at',
                '2026-01-02T00:00:00Z',
                '--yes',
                '--json',
            ]),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_mcp_server_import',
                arguments: {
                    sourceAgent: 'codex',
                    sourceId: 'source-1',
                    importerVersion: '1',
                    name: 'Example',
                    sourcePath: '/project/config',
                    sourceCreatedAt: '2026-01-01T00:00:00Z',
                    sourceUpdatedAt: '2026-01-02T00:00:00Z',
                    server: {
                        kind: 'static',
                        endpoint: 'https://example.com/mcp',
                        headerName: 'X-API-Key',
                        scheme: 'raw',
                        vaultRef: 'vault:12345678-1234-1234-1234-123456789abc',
                    },
                    confirm: true,
                },
            },
        ]);
        expect(JSON.parse(stdout)).toEqual(reply);
    });

    it('requires permission and noninteractive confirmation before calling', async () => {
        expect(await runCloud(host, [...base, '--json'])).toBe(4);
        expect(stderr).toContain('--yes');
        expect(calls).toEqual([]);
        stderr = '';
        await signIn([]);
        expect(await runCloud(host, [...base, '--yes', '--json'])).toBe(3);
        expect(stderr).toContain('connectors:import');
        expect(calls).toEqual([]);
    });

    it('does not prompt for consent when JSON output is requested at a terminal', async () => {
        let prompted = false;
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                stdoutIsTerminal: true,
                prompt: async () => {
                    prompted = true;
                    return 'yes';
                },
            },
        };
        expect(await runCloud(host, [...base, '--json'])).toBe(4);
        expect(prompted).toBe(false);
        expect(calls).toEqual([]);
    });

    it('rejects local executables, credential values and endpoints containing secrets', async () => {
        const local = [...base];
        local[local.indexOf('oauth')] = 'local';
        expect(await runCloud(host, [...local, '--yes', '--json'])).toBe(2);
        const secret = [...base];
        secret[secret.indexOf('oauth')] = 'static';
        expect(
            await runCloud(host, [
                ...secret,
                '--header-name',
                'X-Key',
                '--scheme',
                'raw',
                '--vault-ref',
                'secret-value',
                '--yes',
                '--json',
            ])
        ).toBe(2);
        const unsafe = [...base];
        unsafe[unsafe.indexOf('https://example.com/mcp')] = 'https://example.com/mcp?token=secret';
        expect(await runCloud(host, [...unsafe, '--yes', '--json'])).toBe(2);
        expect(calls).toEqual([]);
    });

    it('shows the proposed import with --dry-run without requesting consent or calling MCP', async () => {
        expect(await runCloud(host, [...base, '--dry-run', '--json']), stderr).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({
            server: { kind: 'oauth', endpoint: 'https://example.com/mcp' },
        });
        expect(calls).toEqual([]);
    });

    it('returns the local-only outcome and propagates the server refusal', async () => {
        const args = [...base];
        args[args.indexOf('https://example.com/mcp')] = 'http://localhost:3000/mcp';
        reply = { status: 'local_only' };
        expect(await runCloud(host, [...args, '--yes', '--json']), stderr).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ status: 'local_only' });
        stdout = '';
        stderr = '';
        refusal = {
            code: -32602,
            message: 'Remote MCP endpoint must resolve to a public HTTPS address.',
            data: { kind: 'invalid_arguments' },
        };
        expect(await runCloud(host, [...base, '--yes', '--json'])).toBe(2);
        expect(stderr).toContain('public HTTPS address');
    });
});
