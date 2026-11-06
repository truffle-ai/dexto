import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
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
                if (rpcError !== null) {
                    const error = rpcError;
                    rpcError = null;
                    return Response.json({ jsonrpc: '2.0', id: message.id, error });
                }
                const value = replies.shift();
                if (value === undefined) throw new Error('Unexpected MCP call');
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: { content: [], structuredContent: value },
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
    it('retries Claude start with the same session and never creates another chat', async () => {
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
                attemptId: 'attempt-1',
                sessionId: 'session-1',
                url: 'https://example.test/authorize',
                expiresAt: null,
                nextAction: 'dexto_connection_finish',
            },
            { outcome: 'connected', name: 'claude', nextAction: null },
        ];
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--json',
                '--code',
                'auth-code',
                '--no-browser',
            ]),
            stderr + stdout
        ).toBe(0);
        expect(calls.map((c) => c.arguments)).toEqual([
            { provider: 'claude' },
            { provider: 'claude', sessionId: 'session-1' },
            { attemptId: 'attempt-1', code: 'auth-code' },
        ]);
        expect(JSON.parse(stdout)).toEqual({
            outcome: 'connected',
            name: 'claude',
            nextAction: null,
        });
        expect(stderr).toBe('');
    });
    it('waits for Codex across pending checks with the original attempt', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'codex',
                attemptId: 'codex-1',
                url: 'https://example.test/device',
                code: 'USER-CODE',
                expiresAt: '2026-11-06T10:00:00Z',
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
                'auth-code',
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
        expect(await runCloud(host, ['connect', 'claude', '--json']), stderr).toBe(0);
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
            6
        );
        expect(JSON.parse(stdout).nextCommand).toBe('dexto connect codex');
    });
    it('returns the Codex URL and user code without waiting', async () => {
        replies = [
            {
                outcome: 'started',
                provider: 'codex',
                attemptId: 'device',
                url: 'https://example.test',
                code: 'USER-CODE',
                expiresAt: '2026-11-06T10:00:00Z',
                pollAfterSeconds: 5,
                nextAction: 'dexto_connection_wait',
            },
        ];
        expect(await runCloud(host, ['connect', 'codex', '--no-wait', '--json'])).toBe(0);
        expect(JSON.parse(stdout).code).toBe('USER-CODE');
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
        expect(stderr).toContain('--session retained');
        expect(calls).toHaveLength(1);
    });
    it('does not resubmit a rejected code or an unhinted failure', async () => {
        rpcError = {
            code: -32004,
            message: 'Cannot finish',
            data: { kind: 'unavailable', retryable: true, resume: null },
        };
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'a1',
                '--code',
                'secret-code',
                '--json',
            ])
        ).toBe(1);
        expect(calls).toHaveLength(1);
        expect(stderr).not.toContain('secret-code');
        expect(stderr).toContain('--attempt a1');
    });
    it('does not prompt for disconnect confirmation under JSON', async () => {
        expect(await runCloud(host, ['connections', 'disconnect', 'codex', '--json'])).toBe(4);
        expect(calls).toHaveLength(0);
    });
    it('uses exit 3 when signed out', async () => {
        await rm(dir, { recursive: true, force: true });
        expect(await runCloud(host, ['connections', 'list', '--json'])).toBe(3);
        expect(calls).toHaveLength(0);
    });

    it('returns a replacement attempt after code rejection without prompting or resubmitting', async () => {
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
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'old',
                '--code',
                'bad-code',
                '--json',
            ])
        ).toBe(6);
        expect(JSON.parse(stdout)).toMatchObject({
            outcome: 'code_rejected',
            attemptId: 'replacement',
            retryable: false,
            resume: null,
        });
        expect(JSON.parse(stdout).nextCommand).toContain('--attempt replacement');
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
        expect(JSON.parse(stdout).nextCommand).toBe('dexto connect claude --session same-chat');
    });
    it('keeps authorization codes out of suggested reruns on a confirmation refusal', async () => {
        rpcError = {
            code: -32003,
            message: 'Consent required',
            data: { kind: 'needs_confirmation', retryable: false, resume: null },
        };
        expect(
            await runCloud(host, [
                'connect',
                'claude',
                '--attempt',
                'old',
                '--code=secret-code',
                '--json',
            ])
        ).toBe(4);
        expect(stderr).not.toContain('secret-code');
        expect(stderr).not.toContain('--code=');
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
            { outcome: 'disconnected', name: 'claude', nextAction: 'dexto_connection_start' },
        ];
        expect(await runCloud(host, ['connections', 'status', 'claude', '--json'])).toBe(6);
        expect(JSON.parse(stdout).nextCommand).toBe('dexto connect claude');
        stdout = '';
        expect(
            await runCloud(host, ['connections', 'disconnect', 'claude', '--yes', '--json'])
        ).toBe(0);
        expect(JSON.parse(stdout).outcome).toBe('disconnected');
        expect(calls.map((c) => c.name)).toEqual([
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
            expiresAt: '2026-11-06T10:00:00Z',
            pollAfterSeconds: 0,
            nextAction: 'dexto_connection_wait',
        };
        replies = [started, { outcome: 'connected', name: 'codex', nextAction: null }];
        beforeWait = () => {
            if (json) {
                expect(stdout.split('\n').filter(Boolean)).toHaveLength(1);
                expect(JSON.parse(stdout)).toEqual(started);
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
        expect(stderr).toContain('--code <code>');
    }, 1000);
});
