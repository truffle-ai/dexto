import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConnection } from '../connection.js';
import { builtCloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';
const MCP = 'https://app.dexto.ai/mcp';
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};
describe('subscription connections over MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let host: CloudHost;
    let calls: { name: string; arguments: unknown }[];
    let replies: unknown[];
    let rpcError: unknown;
    let rpcErrors: unknown[];
    const lastResult = () => JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
    let stdin: string;
    let stdinIsTerminal: boolean;
    let readStdin: () => Promise<string>;
    let stdoutIsTerminal: boolean;
    let beforeWait: () => void;
    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-connect-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        rpcError = null;
        rpcErrors = [];
        stdin = '';
        stdinIsTerminal = true;
        readStdin = async () => stdin;
        stdoutIsTerminal = false;
        beforeWait = () => undefined;
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
            environment: {},
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url !== MCP)
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                const message = await request.json();
                calls.push(message.params);
                if (message.params.name === 'dexto_connection_wait') beforeWait();
                const queuedError = rpcErrors.shift() ?? rpcError;
                if (queuedError !== null) {
                    const error = queuedError;
                    rpcError = null;
                    return Response.json({ jsonrpc: '2.0', id: message.id, error });
                }
                const value = replies.shift();
                if (value === undefined) throw new Error('Unexpected MCP call');
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result:
                        message.method === 'tools/list'
                            ? value
                            : { content: [], structuredContent: value },
                });
            },
            get prompt() {
                return stdinIsTerminal
                    ? async () => {
                          throw new Error('Must not prompt');
                      }
                    : null;
            },
            readStdin: () => readStdin(),
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
            // The catalog connector is held from 2.0 but stays tested for its release.
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
            signInForScope: async () => false,
        };
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        await rm(path.dirname(dir), { recursive: true, force: true });
    });
    it('rejects OAuth state as a connector attempt and prints only the opaque id to resume', async () => {
        const state = 'secret-oauth-state';
        const id = '00000000-0000-4000-8000-000000000123';
        expect(
            await runCloud(host, ['connect', 'notion', '--attempt', state, '--no-wait'])
        ).not.toBe(0);
        expect(calls).toHaveLength(0);
        stdout = '';
        stdoutIsTerminal = true;
        replies = [
            {
                outcome: 'started',
                provider: 'notion',
                attemptId: id,
                url: `https://example.test/approve?state=${state}`,
                nextAction: 'dexto_connection_wait',
            },
        ];
        expect(await runCloud(host, ['connect', 'notion', '--no-browser', '--no-wait'])).toBe(0);
        const resumeLine = stdout.split('\n').find((line) => line.includes('--attempt'));
        expect(resumeLine).toContain(`--attempt ${id}`);
        expect(resumeLine).not.toContain(state);
    });
    it('starts a catalog connector and reports its completed authorization', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'github',
                attemptId: '00000000-0000-4000-8000-000000000001',
                url: 'https://example.test/approve',
                nextAction: 'dexto_connection_wait',
            },
            { outcome: 'connected', name: 'github', nextAction: null },
        ];
        const exitCode = await runCloud(host, ['connect', 'github', '--no-browser', '--json']);
        expect(exitCode).toBe(0);
        expect(calls).toEqual([
            { name: 'dexto_connection_start', arguments: { provider: 'github' } },
            {
                name: 'dexto_connection_wait',
                arguments: {
                    provider: 'github',
                    attemptId: '00000000-0000-4000-8000-000000000001',
                },
            },
        ]);
        expect(lastResult()).toMatchObject({ outcome: 'connected', name: 'github' });
    });
    it('reports a catalog connector that completes without browser authorization', async () => {
        replies = [{ outcome: 'connected', name: 'public-mcp', nextAction: null }];
        expect(await runCloud(host, ['connect', 'public-mcp', '--no-browser', '--json'])).toBe(0);
        expect(lastResult()).toMatchObject({ outcome: 'connected', name: 'public-mcp' });
        expect(calls).toHaveLength(1);
    });
    it('lists and disconnects an owned connector', async () => {
        const row = {
            kind: 'connector',
            name: 'github',
            id: 'conn-1',
            provider: 'github',
            status: 'connected',
            nextAction: null,
        };
        replies = [
            { connections: [row] },
            row,
            { outcome: 'disconnected', name: 'github', nextAction: 'dexto_connection_start' },
        ];
        expect(await runCloud(host, ['connections', 'list', '--json'])).toBe(0);
        expect(lastResult().connections).toEqual([row]);
        expect(
            await runCloud(host, ['connections', 'disconnect', 'github', '--yes', '--json'])
        ).toBe(0);
        expect(calls.at(-1)).toEqual({
            name: 'dexto_connection_disconnect',
            arguments: { name: 'github' },
        });
    });
    it('uses an already connected fake X account through capability discovery and execution without signing in again (DEXTO-2923)', async () => {
        const path = 'dexto.x.fixture-account.search_recent_posts';
        const tools = [
            {
                name: 'dexto_capabilities_search',
                inputSchema: { type: 'object' },
                _meta: { 'dexto/level': 'read' },
            },
            {
                name: 'dexto_capability_describe',
                inputSchema: { type: 'object' },
                _meta: { 'dexto/level': 'read' },
            },
            {
                name: 'dexto_capability_call',
                inputSchema: { type: 'object' },
                _meta: { 'dexto/level': 'act' },
            },
        ];
        replies = [
            {
                connections: [
                    {
                        kind: 'connector',
                        name: 'x',
                        id: 'fixture-x',
                        provider: 'x',
                        status: 'connected',
                        nextAction: null,
                    },
                ],
            },
            { tools },
            { tools: [{ path, description: 'Search the connected fake X account' }] },
            { tools },
            { found: true, tool: { path, inputSchema: { type: 'object' } } },
            { tools },
            { ok: true, result: { posts: [{ id: 'fixture-post', text: 'Synthetic X result' }] } },
        ];
        expect(await runCloud(host, ['connections', 'list', '--json'])).toBe(0);
        expect(lastResult().connections[0].status).toBe('connected');
        stdout = '';
        expect(
            await runCloud(host, [
                'workspace',
                'call',
                'dexto_capabilities_search',
                '--data',
                JSON.stringify({ query: 'X search recent posts' }),
                '--json',
            ]),
            stderr
        ).toBe(0);
        expect(JSON.parse(stdout).tools[0].path).toBe(path);
        stdout = '';
        expect(
            await runCloud(host, [
                'workspace',
                'call',
                'dexto_capability_describe',
                '--data',
                JSON.stringify({ path }),
                '--json',
            ])
        ).toBe(0);
        expect(JSON.parse(stdout).found).toBe(true);
        stdout = '';
        expect(
            await runCloud(host, [
                'workspace',
                'call',
                'dexto_capability_call',
                '--data',
                JSON.stringify({ path, input: { query: 'synthetic release' } }),
                '--yes',
                '--json',
            ])
        ).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({
            ok: true,
            result: { posts: [{ id: 'fixture-post' }] },
        });
        expect(calls.at(-1)).toEqual({
            name: 'dexto_capability_call',
            arguments: { path, input: { query: 'synthetic release' } },
        });
        expect(
            calls.some(
                (call) =>
                    call.name === 'dexto_connection_start' || call.name === 'dexto_connection_wait'
            )
        ).toBe(false);
    });
    it('returns a resumable connector attempt without waiting', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'notion',
                attemptId: '00000000-0000-4000-8000-000000000002',
                url: 'https://example.test/approve',
                nextAction: 'dexto_connection_wait',
            },
        ];
        expect(
            await runCloud(host, ['connect', 'notion', '--no-browser', '--no-wait', '--json'])
        ).toBe(0);
        expect(lastResult()).toMatchObject({
            outcome: 'started',
            attemptId: '00000000-0000-4000-8000-000000000002',
            url: 'https://example.test/approve',
        });
        expect(calls).toHaveLength(1);
    });
    it('keeps the attempt when a connector wait needs permission', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'github',
                attemptId: '00000000-0000-4000-8000-000000000003',
                url: 'https://example.test/approve',
                nextAction: 'dexto_connection_wait',
            },
        ];
        beforeWait = () => {
            rpcError = {
                code: -32003,
                message: 'Permission required',
                data: { kind: 'forbidden', scope: 'models:write' },
            };
        };
        expect(await runCloud(host, ['connect', 'github', '--no-browser', '--json'])).not.toBe(0);
        expect(calls.filter((call) => call.name === 'dexto_connection_start')).toHaveLength(1);
        expect(stderr).toContain(
            'dexto connect github --attempt 00000000-0000-4000-8000-000000000003'
        );
    });
    it.each(['cancelled', 'failed'])('reports a connector attempt that %s', async (outcome) => {
        replies = [
            {
                outcome: 'started',
                provider: 'github',
                attemptId: '00000000-0000-4000-8000-000000000004',
                url: 'https://example.test/approve',
                nextAction: 'dexto_connection_wait',
            },
            {
                outcome,
                attemptId: '00000000-0000-4000-8000-000000000004',
                nextAction: 'dexto_connection_start',
            },
        ];
        expect(await runCloud(host, ['connect', 'github', '--no-browser', '--json'])).toBe(1);
        expect(lastResult()).toMatchObject({
            outcome,
            attemptId: '00000000-0000-4000-8000-000000000004',
        });
    });
    it('starts Console sign-in on the requested chat and preserves the method during retries', async () => {
        replies = [
            {
                outcome: 'retry',
                sessionId: 'chat-1',
                retryAfterSeconds: 0,
                nextAction: 'dexto_connection_start',
            },
            {
                outcome: 'started',
                provider: 'claude',
                attemptId: 'a1',
                sessionId: 'chat-1',
                url: 'https://example.test/auth',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            },
        ];
        expect(
            await runCloud(host, ['connect', 'claude', '--chat', 'chat-1', '--console', '--json']),
            stderr
        ).toBe(6);
        expect(calls.map((call) => call.arguments)).toEqual([
            { provider: 'claude', sessionId: 'chat-1', method: 'console' },
            { provider: 'claude', sessionId: 'chat-1', method: 'console' },
        ]);
    });
    it.each([['--code', 'secret-code'], ['--code=secret-code']])(
        'rejects authorization codes supplied as command arguments without echoing them',
        async (...args) => {
            expect(await runCloud(host, ['connect', 'claude', ...args, '--json'])).toBe(2);
            expect(calls).toHaveLength(0);
            expect(stdout + stderr).not.toContain('secret-code');
            expect(stderr).toContain('--code -');
        }
    );
    it('retries Claude start with the same session and never creates another chat', async () => {
        stdin = 'auth-code';
        replies = [
            {
                outcome: 'retry',
                sessionId: 'session-1',
                retryAfterSeconds: 0,
                nextAction: 'dexto_connection_start',
            },
            {
                outcome: 'started',
                provider: 'claude',
                attemptId: '00000000-0000-4000-8000-000000000001',
                sessionId: 'session-1',
                url: 'https://example.test/authorize',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            },
            { outcome: 'connected', name: 'claude', nextAction: null },
        ];
        expect(
            await runCloud(host, ['connect', 'claude', '--json', '--code', '-', '--no-browser']),
            stderr + stdout
        ).toBe(0);
        expect(calls.map((c) => c.arguments)).toEqual([
            { provider: 'claude' },
            { provider: 'claude', sessionId: 'session-1' },
            { attemptId: '00000000-0000-4000-8000-000000000001', code: 'auth-code' },
        ]);
        expect(lastResult()).toEqual({
            outcome: 'connected',
            name: 'claude',
            nextAction: null,
        });
        expect(stderr).toBe('');
    });
    it('tells the person to restart after an uncertain Codex exchange', async () => {
        replies = [
            {
                outcome: 'expired_retry_sign_in',
                attemptId: '00000000-0000-4000-8000-000000000001',
                nextAction: 'dexto_connection_start',
            },
        ];
        stdoutIsTerminal = true;
        expect(
            await runCloud(host, [
                'connect',
                'codex',
                '--attempt',
                '00000000-0000-4000-8000-000000000001',
                '--no-browser',
            ])
        ).toBe(1);
        expect(stdout).toContain("Sign-in didn't finish. Run `dexto connect codex` again.");
    });
    it('waits for Codex across pending checks with the original attempt', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'codex',
                attemptId: 'codex-1',
                url: 'https://example.test/device',
                code: 'USER-CODE',
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                pollAfterSeconds: 0,
                nextAction: 'dexto_connection_wait',
            },
            { outcome: 'timeout', attemptId: 'codex-1', nextAction: 'dexto_connection_wait' },
            { outcome: 'connected', name: 'codex', nextAction: null },
        ];
        expect(
            await runCloud(host, ['connect', 'codex', '--json', '--no-browser']),
            stderr + stdout
        ).toBe(0);
        expect(calls.map((c) => c.arguments)).toEqual([
            { provider: 'codex' },
            { provider: 'codex', attemptId: 'codex-1', timeoutSeconds: 25 },
            { provider: 'codex', attemptId: 'codex-1', timeoutSeconds: 25 },
        ]);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '').outcome).toBe('connected');
    });
    it('lists typed connection rows and refuses an API-key disconnect verbatim', async () => {
        replies = [
            {
                connections: [
                    {
                        kind: 'codex_status',
                        name: 'codex',
                        status: 'disconnected',
                        nextAction: 'dexto_connection_start',
                    },
                ],
            },
        ];
        expect(await runCloud(host, ['connections', 'list', '--json'])).toBe(0);
        expect(calls[0]?.name).toBe('dexto_connections_list');
        stdout = '';
        rpcError = {
            code: -32005,
            message:
                'Only subscriptions can be disconnected here. Use dashboard Settings > Models.',
            data: { kind: 'unprocessable' },
        };
        expect(
            await runCloud(host, ['connections', 'disconnect', 'key-1', '--yes', '--json'])
        ).toBe(2);
        expect(JSON.parse(stderr).error.message).toBe(
            'Only subscriptions can be disconnected here. Use dashboard Settings > Models.'
        );
        expect(stdout).toBe('');
    });
    it('resumes only the save when a retryable refusal explicitly permits it', async () => {
        stdin = 'auth-code';
        rpcError = {
            code: -32004,
            message: 'Save temporarily unavailable',
            data: {
                kind: 'unavailable',
                retryable: true,
                resume: {
                    action: 'save',
                    tool: 'dexto_connection_finish',
                    arguments: { attemptId: 'accepted-1' },
                },
            },
        };
        replies = [{ outcome: 'connected', name: 'claude', nextAction: null }];
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'accepted-1',
                '--code',
                '-',
                '--json',
            ]),
            stderr
        ).toBe(0);
        expect(calls.map((c) => c.arguments)).toEqual([
            { attemptId: 'accepted-1', code: 'auth-code' },
            { attemptId: 'accepted-1' },
        ]);
        expect(stdout).not.toContain('auth-code');
    });

    it('reads a Claude code from stdin under --json without prompting', async () => {
        stdinIsTerminal = false;
        stdin = 'stdin-code\n';
        replies = [
            {
                outcome: 'started',
                provider: 'claude',
                attemptId: 'a1',
                sessionId: 's1',
                url: 'https://example.test',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            },
            { outcome: 'connected', name: 'claude', nextAction: null },
        ];
        expect(await runCloud(host, ['connect', 'claude', '--json', '--code', '-']), stderr).toBe(
            0
        );
        expect(calls[1]?.arguments).toEqual({ attemptId: 'a1', code: 'stdin-code' });
    });
    it('retries a saved Claude attempt without code or a new start', async () => {
        replies = [{ outcome: 'connected', name: 'claude', nextAction: null }];
        expect(await runCloud(host, ['connect', 'claude', '--attempt', 'saved', '--json'])).toBe(0);
        expect(calls).toEqual([
            { name: 'dexto_connection_finish', arguments: { attemptId: 'saved' } },
        ]);
    });
    it('returns expiry non-zero with the command to start again', async () => {
        replies = [
            { outcome: 'expired', attemptId: 'expired', nextAction: 'dexto_connection_start' },
        ];
        expect(await runCloud(host, ['connect', 'codex', '--attempt', 'expired', '--json'])).toBe(
            1
        );
        expect(lastResult().nextCommand).toBe('dexto connect codex');
    });
    it('returns the Codex URL and user code without waiting', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'codex',
                attemptId: 'device',
                url: 'https://example.test',
                code: 'USER-CODE',
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                pollAfterSeconds: 5,
                nextAction: 'dexto_connection_wait',
            },
        ];
        expect(await runCloud(host, ['connect', 'codex', '--no-wait', '--json'])).toBe(0);
        expect(lastResult().code).toBe('USER-CODE');
        expect(calls).toHaveLength(1);
    });
    it('reports a retained chat on hard Claude start refusal', async () => {
        rpcError = {
            code: -32004,
            message: 'Compute unavailable',
            data: { kind: 'unavailable', sessionId: 'retained', retryable: false, resume: null },
        };
        expect(await runCloud(host, ['connect', 'claude', '--json'])).toBe(1);
        expect(stderr).toContain('retained');
        expect(stderr).toContain('--chat retained');
        expect(calls).toHaveLength(1);
    });
    it('does not resubmit a rejected code or an unhinted failure', async () => {
        stdin = 'secret-code';
        rpcError = {
            code: -32004,
            message: 'Cannot finish',
            data: { kind: 'unavailable', retryable: true, resume: null },
        };
        expect(
            await runCloud(host, ['connect', 'claude', '--attempt', 'a1', '--code', '-', '--json'])
        ).toBe(1);
        expect(calls).toHaveLength(1);
        expect(stderr).not.toContain('secret-code');
        expect(JSON.parse(stderr).error.fix).toBe('dexto connect claude --attempt a1 --code -');
    });
    it('does not prompt for disconnect confirmation under JSON', async () => {
        replies = [
            {
                kind: 'codex_status',
                name: 'codex',
                status: 'disconnected',
                nextAction: 'dexto_connection_start',
            },
        ];
        expect(await runCloud(host, ['connections', 'disconnect', 'codex', '--json'])).toBe(4);
        expect(calls).toEqual([{ name: 'dexto_connection_get', arguments: { name: 'codex' } }]);
    });
    it('uses exit 3 when signed out', async () => {
        await rm(dir, { recursive: true, force: true });
        expect(await runCloud(host, ['connections', 'list', '--json'])).toBe(3);
        expect(calls).toHaveLength(0);
    });

    it('returns a replacement attempt after code rejection without prompting or resubmitting', async () => {
        stdin = 'bad-code';
        replies = [
            {
                outcome: 'code_rejected',
                attemptId: 'replacement',
                url: 'https://example.test/new',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
                retryable: false,
                resume: null,
            },
        ];
        expect(
            await runCloud(host, ['connect', 'claude', '--attempt', 'old', '--code', '-', '--json'])
        ).toBe(6);
        expect(lastResult()).toMatchObject({
            outcome: 'code_rejected',
            attemptId: 'replacement',
            retryable: false,
            resume: null,
        });
        expect(lastResult().nextCommand).toContain('--attempt replacement');
        expect(calls).toHaveLength(1);
    });
    it('bounds Claude warming retries and keeps the session in its next command', async () => {
        replies = Array.from({ length: 12 }, () => ({
            outcome: 'retry',
            sessionId: 'same-chat',
            retryAfterSeconds: 0,
            nextAction: 'dexto_connection_start',
        }));
        expect(await runCloud(host, ['connect', 'claude', '--json'])).toBe(6);
        expect(calls).toHaveLength(12);
        expect(
            calls
                .slice(1)
                .every(
                    (c) =>
                        JSON.stringify(c.arguments) ===
                        JSON.stringify({ provider: 'claude', sessionId: 'same-chat' })
                )
        ).toBe(true);
        expect(lastResult().nextCommand).toBe('dexto connect claude --chat same-chat');
    });
    it('keeps authorization codes out of permission-refusal suggestions', async () => {
        stdin = 'secret-code';
        rpcError = {
            code: -32003,
            message: 'Permission required',
            data: { kind: 'forbidden', retryable: false, resume: null },
        };
        expect(
            await runCloud(host, ['connect', 'claude', '--attempt', 'old', '--code', '-', '--json'])
        ).toBe(3);
        expect(stderr).not.toContain('secret-code');
        expect(stderr).not.toContain('--code=');
        expect(JSON.parse(stderr).error.fix).toBe('dexto connect claude --attempt old --code -');
        expect(stderr).not.toContain('--yes');
    });
    it('does not consume a piped code during a save-only resume', async () => {
        stdinIsTerminal = false;
        stdin = 'new-code\n';
        replies = [{ outcome: 'connected', name: 'claude', nextAction: null }];
        expect(
            await runCloud(host, ['connect', 'claude', '--attempt', 'replacement', '--json'])
        ).toBe(0);
        expect(calls[0]?.arguments).toEqual({ attemptId: 'replacement' });
    });

    it('returns disconnected status with a next command, then disconnects with consent', async () => {
        replies = [
            {
                kind: 'claude_home',
                name: 'claude',
                provider: 'claude',
                status: 'disconnected',
                available: true,
                nextAction: 'dexto_connection_start',
            },
            {
                kind: 'claude_home',
                name: 'claude',
                provider: 'claude',
                status: 'disconnected',
                available: true,
                nextAction: 'dexto_connection_start',
            },
            { outcome: 'disconnected', name: 'claude', nextAction: 'dexto_connection_start' },
        ];
        expect(await runCloud(host, ['connections', 'status', 'claude', '--json'])).toBe(6);
        expect(lastResult().nextCommand).toBe('dexto connect claude');
        stdout = '';
        expect(
            await runCloud(host, ['connections', 'disconnect', 'claude', '--yes', '--json'])
        ).toBe(0);
        expect(lastResult().outcome).toBe('disconnected');
        expect(calls.map((c) => c.name)).toEqual([
            'dexto_connection_get',
            'dexto_connection_get',
            'dexto_connection_disconnect',
        ]);
    });

    it.each([
        { mode: 'explicit JSON', terminal: true, flags: ['--json'], json: true },
        { mode: 'redirected stdout', terminal: false, flags: [], json: true },
        { mode: 'human output', terminal: true, flags: [], json: false },
    ])('exposes Codex authorization before waiting in $mode', async ({ terminal, flags, json }) => {
        stdoutIsTerminal = terminal;
        const started = {
            outcome: 'started',
            provider: 'codex',
            attemptId: 'visible-device',
            url: 'https://example.test/device',
            code: 'VISIBLE-CODE',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            pollAfterSeconds: 0,
            nextAction: 'dexto_connection_wait',
        };
        replies = [started, { outcome: 'connected', name: 'codex', nextAction: null }];
        beforeWait = () => {
            if (json) {
                expect(stdout.split('\n').filter(Boolean)).toHaveLength(1);
                expect(lastResult()).toEqual(started);
                expect(stderr).toBe('');
            } else {
                expect(stderr).toContain(started.url);
                expect(stderr).toContain(started.code);
            }
        };
        expect(await runCloud(host, ['connect', 'codex', '--no-browser', ...flags]), stderr).toBe(
            0
        );
        if (json) {
            const lines = stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(lines).toEqual([
                started,
                { outcome: 'connected', name: 'codex', nextAction: null },
            ]);
        } else expect(stdout).toBe('Codex connected.\n');
    });

    it.each([true, false])(
        'does not consume stdin for a save-only resume (stdin TTY: %s)',
        async (terminal) => {
            stdinIsTerminal = terminal;
            readStdin = vi.fn(() => new Promise<string>(() => undefined));
            replies = [{ outcome: 'connected', name: 'claude', nextAction: null }];
            expect(
                await runCloud(host, ['connect', 'claude', '--attempt', 'save-only', '--json'])
            ).toBe(0);
            expect(readStdin).not.toHaveBeenCalled();
            expect(calls).toEqual([
                { name: 'dexto_connection_finish', arguments: { attemptId: 'save-only' } },
            ]);
        },
        1000
    );
    it('returns the code-required outcome at a JSON TTY without reading or prompting', async () => {
        readStdin = vi.fn(() => new Promise<string>(() => undefined));
        replies = [
            {
                outcome: 'started',
                provider: 'claude',
                attemptId: 'needs-code',
                sessionId: 'chat',
                url: 'https://example.test',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            },
        ];
        expect(await runCloud(host, ['connect', 'claude', '--json'])).toBe(6);
        expect(readStdin).not.toHaveBeenCalled();
        expect(calls).toHaveLength(1);
        expect(lastResult().nextCommand).toContain('--code -');
    }, 1000);

    it.each([{ flags: ['--json'] }, { flags: [] }])(
        'exposes Claude authorization without consuming an open pipe (%j)',
        async ({ flags }) => {
            stdinIsTerminal = false;
            readStdin = vi.fn(() => new Promise<string>(() => undefined));
            const started = {
                outcome: 'started',
                provider: 'claude',
                attemptId: 'open-pipe',
                sessionId: 'chat',
                url: 'https://example.test/claude',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            };
            replies = [started];
            expect(await runCloud(host, ['connect', 'claude', ...flags]), stderr).toBe(6);
            expect(readStdin).not.toHaveBeenCalled();
            const lines = stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(lines[0]).toEqual(started);
            expect(lines[1]).toMatchObject({
                outcome: 'code_required',
                attemptId: 'open-pipe',
                sessionId: 'chat',
                url: started.url,
                nextCommand: 'dexto connect claude --attempt open-pipe --code -',
            });
        },
        1000
    );

    it('accepts explicit stdin for an existing attempt without exposing the code', async () => {
        stdin = 'piped-secret\n';
        replies = [{ outcome: 'connected', name: 'claude', nextAction: null }];
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'existing',
                '--code',
                '-',
                '--json',
            ])
        ).toBe(0);
        expect(calls[0]?.arguments).toEqual({ attemptId: 'existing', code: 'piped-secret' });
        expect(stdout + stderr).not.toContain('piped-secret');
    });
    it('rejects an option in place of --code without starting authorization', async () => {
        expect(await runCloud(host, ['connect', 'claude', '--code', '--json'])).toBe(2);
        expect(calls).toHaveLength(0);
        expect(JSON.parse(stderr).error.message).toContain('Missing value for --code');
        expect(stderr.trim().split('\n')).toHaveLength(1);
    });
    it('retains a save-only recovery hint after the third retryable save refusal', async () => {
        stdin = 'auth-code';
        rpcErrors = [1, 2, 3].map((n) => ({
            code: -32004,
            message: 'Save failed',
            data: {
                kind: 'unavailable',
                retryable: true,
                resume: {
                    action: 'save',
                    tool: 'dexto_connection_finish',
                    arguments: { attemptId: `hint-${n}` },
                },
            },
        }));
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'original',
                '--code',
                '-',
                '--json',
            ])
        ).toBe(1);
        expect(calls.map((c) => c.arguments)).toEqual([
            { attemptId: 'original', code: 'auth-code' },
            { attemptId: 'hint-1' },
            { attemptId: 'hint-2' },
        ]);
        expect(JSON.parse(stderr).error.fix).toBe('dexto connect claude --attempt hint-3');
        expect(stderr).not.toContain('auth-code');
    });
    it('keeps refusal identity when the resume hint has a future shape', async () => {
        rpcError = {
            code: -32004,
            message: 'Unavailable',
            data: {
                kind: 'unavailable',
                sessionId: 'retained-chat',
                scope: 'models:write',
                retryable: true,
                resume: { action: 'future' },
            },
        };
        expect(await runCloud(host, ['connect', 'claude', '--json'])).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('models:write');
        expect(calls).toHaveLength(1);
    });
    it('never echoes the human authorization code and refuses provider API keys', async () => {
        stdoutIsTerminal = true;
        host = { ...host, runtime: { ...host.runtime, prompt: async () => 'human-secret' } };
        replies = [
            {
                outcome: 'started',
                provider: 'claude',
                attemptId: 'human',
                sessionId: 'chat',
                url: 'https://example.test/claude',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            },
            { outcome: 'connected', name: 'claude', nextAction: null },
        ];
        expect(await runCloud(host, ['connect', 'claude', '--no-browser'])).toBe(0);
        expect(calls[1]?.arguments).toEqual({ attemptId: 'human', code: 'human-secret' });
        expect(stdout + stderr).not.toContain('human-secret');
        stdout = '';
        stderr = '';
        calls = [];
        expect(
            await runCloud(host, ['connect', 'claude', '--code', 'sk-ant-test-key', '--json'])
        ).toBe(2);
        expect(stdout + stderr).not.toContain('sk-ant-test-key');
        expect(calls).toHaveLength(0);
    });

    it('resumes an unavailable Codex wait instead of restarting authorization', async () => {
        beforeWait = () => {
            rpcError = {
                code: -32004,
                message: 'Provider unavailable',
                data: { kind: 'unavailable', retryable: true, resume: null },
            };
        };
        expect(
            await runCloud(host, ['connect', 'codex', '--attempt', 'pending-device', '--json'])
        ).toBe(1);
        expect(JSON.parse(stderr).error.fix).toBe('dexto connect codex --attempt pending-device');
    });
    it('ends Codex polling at the server expiry deadline', async () => {
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        replies = [
            {
                outcome: 'started',
                provider: 'codex',
                attemptId: 'deadline',
                url: 'https://example.test/device',
                code: 'CODE',
                expiresAt: new Date(now + 1000).toISOString(),
                pollAfterSeconds: 0,
                nextAction: 'dexto_connection_wait',
            },
            { outcome: 'timeout', attemptId: 'deadline', nextAction: 'dexto_connection_wait' },
        ];
        beforeWait = () => {
            now += 1000;
        };
        expect(await runCloud(host, ['connect', 'codex', '--json'])).toBe(1);
        expect(calls).toHaveLength(2);
        expect(calls[1]?.arguments).toEqual({
            provider: 'codex',
            attemptId: 'deadline',
            timeoutSeconds: 1,
        });
        expect(lastResult()).toMatchObject({
            outcome: 'expired',
            nextCommand: 'dexto connect codex',
        });
        vi.restoreAllMocks();
    });
    it('treats unavailable Claude and a connection with no next action as failures', async () => {
        replies = [
            {
                kind: 'claude_home',
                name: 'claude',
                provider: 'claude',
                status: 'disconnected',
                available: false,
                nextAction: null,
            },
        ];
        expect(await runCloud(host, ['connections', 'status', 'claude', '--json'])).toBe(1);
        expect(lastResult().nextCommand).toBe('dexto connect claude');
        replies = [
            {
                kind: 'claude_home',
                name: 'claude',
                provider: 'claude',
                status: 'disconnected',
                available: true,
                nextAction: null,
            },
        ];
        expect(await runCloud(host, ['connections', 'status', 'claude', '--json'])).toBe(1);
        expect(lastResult().nextCommand).toBe('dexto connect claude');
    });
    it('refuses API-key disconnects before asking for consent', async () => {
        replies = [
            {
                kind: 'model_connection',
                name: 'key',
                id: 'key',
                provider: 'openai',
                authType: 'api_key',
                methodId: 'api_key',
                label: null,
                status: 'connected',
                createdAt: 'now',
                updatedAt: 'now',
                lastTestedAt: null,
                maskedIdentifier: 'masked',
                nextAction: null,
            },
        ];
        expect(await runCloud(host, ['connections', 'disconnect', 'key', '--json'])).toBe(2);
        expect(calls).toEqual([{ name: 'dexto_connection_get', arguments: { name: 'key' } }]);
        expect(JSON.parse(stderr).error.message).toContain('dashboard Settings > Models');
    });

    it('keeps Claude no-wait suggestions safe and emits compact JSON records', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'claude',
                attemptId: 'safe',
                sessionId: 'chat',
                url: 'https://example.test',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            },
        ];
        expect(await runCloud(host, ['connect', 'claude', '--json', '--no-wait'])).toBe(0);
        expect(stdout.trim().split('\n')).toHaveLength(1);
        stdout = '';
        expect(
            await runCloud(host, ['connect', 'claude', '--json', '--attempt', 'safe', '--no-wait'])
        ).toBe(0);
        expect(lastResult().nextCommand).toBe('dexto connect claude --attempt safe --code -');
        replies = [{ connections: [] }];
        stdout = '';
        expect(await runCloud(host, ['connections', 'list', '--json'])).toBe(0);
        expect(
            stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line))
        ).toEqual([{ connections: [] }]);
    });

    it('documents explicit stdin in compact JSON help', async () => {
        expect(await runCloud(host, ['connect', 'claude', '--help', '--json'])).toBe(0);
        expect(stdout.trim().split('\n')).toHaveLength(1);
        expect(stdout).toContain('--code -');
        expect(stdout).not.toContain('on stdin with --json');
    });
    it('restarts a dead Claude attempt using its retained chat', async () => {
        rpcError = {
            code: -32004,
            message: 'Attempt expired',
            data: { kind: 'invalid_state', sessionId: 'chat', retryable: false, resume: null },
        };
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'dead',
                '--code',
                '-',
                '--json',
            ])
        ).toBe(6);
        // Empty explicit input needs a code before contacting the server.
        expect(calls).toHaveLength(0);
        stdout = '';
        stderr = '';
        stdin = 'code';
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'dead',
                '--code',
                '-',
                '--json',
            ])
        ).toBe(1);
        expect(JSON.parse(stderr).error.fix).toBe('dexto connect claude --chat chat');
    });

    it.each([
        { provider: 'openai', status: 'invalid' },
        { provider: 'anthropic', status: 'needs_reauth' },
    ])(
        'routes $provider API-key status recovery to the dashboard',
        async ({ provider, status }) => {
            replies = [
                {
                    kind: 'model_connection',
                    name: 'saved-key',
                    id: 'saved-key',
                    provider,
                    authType: 'api_key',
                    methodId: 'api_key',
                    label: null,
                    status,
                    createdAt: 'now',
                    updatedAt: 'now',
                    lastTestedAt: null,
                    maskedIdentifier: 'masked',
                    nextAction: null,
                },
            ];
            expect(await runCloud(host, ['connections', 'status', 'saved-key', '--json'])).toBe(1);
            expect(lastResult()).toMatchObject({
                nextCommand: null,
                fix: 'Update it in dashboard Settings > Models',
            });
            expect(stdout).not.toContain(`dexto connect ${provider}`);
        }
    );

    it.each([
        { kind: 'not_found', code: -32004, exit: 5 },
        { kind: 'invalid_arguments', code: -32602, exit: 2 },
    ])('restarts a $kind Codex wait attempt', async ({ kind, code, exit }) => {
        rpcError = {
            code,
            message: 'Attempt cannot be resumed',
            data: { kind, retryable: false, resume: null },
        };
        expect(await runCloud(host, ['connect', 'codex', '--attempt', 'dead', '--json'])).toBe(
            exit
        );
        expect(JSON.parse(stderr).error.fix).toBe('dexto connect codex');
        expect(calls).toHaveLength(1);
    });
    it('preserves the missing-scope sign-in prompt during Codex wait', async () => {
        stdoutIsTerminal = true;
        const grant = vi.fn(async () => false);
        host = {
            ...host,
            runtime: { ...host.runtime, prompt: vi.fn(async () => 'yes') },
            signInForScope: grant,
        };
        rpcError = {
            code: -32003,
            message: 'Permission required',
            data: { kind: 'forbidden', scope: 'models:write', retryable: false, resume: null },
        };
        expect(await runCloud(host, ['connect', 'codex', '--attempt', 'pending'])).toBe(3);
        expect(grant).toHaveBeenCalledWith(expect.anything(), 'models:write', expect.any(Function));
    });

    it('restarts Claude when the retained start chat was not found', async () => {
        rpcError = {
            code: -32004,
            message: 'Chat not found',
            data: { kind: 'not_found', sessionId: 'deleted-chat', retryable: false, resume: null },
        };
        expect(await runCloud(host, ['connect', 'claude', '--json'])).toBe(5);
        expect(JSON.parse(stderr).error.fix).toBe('dexto connect claude');
        expect(calls).toEqual([
            { name: 'dexto_connection_start', arguments: { provider: 'claude' } },
        ]);
    });
});
