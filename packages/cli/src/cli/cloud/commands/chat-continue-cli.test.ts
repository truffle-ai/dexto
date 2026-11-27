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

/** `dexto chat continue` through the real command boundary and MCP transport. */
describe('dexto chat continue', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: Record<string, unknown>[];
    let lostAnswers: number;
    let host: CloudHost;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-chat-continue-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        lostAnswers = 0;
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
            scopes: ['sessions:write'],
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
                if (
                    message.method !== 'tools/call' ||
                    message.params.name !== 'dexto_chat_continue'
                )
                    throw new Error('Unexpected MCP call');
                calls.push(message.params.arguments);
                // The server may have accepted the turn; the answer never arrives.
                if (lostAnswers > 0) {
                    lostAnswers -= 1;
                    throw new TypeError('fetch failed');
                }
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        structuredContent: {
                            status: 'accepted',
                            replayed: calls.length > 1,
                            run: { id: 'run-2', status: 'queued' },
                            session: {
                                id: 'chat-review',
                                title: 'Review',
                                url: 'https://app.dexto.ai/chat/chat-review',
                            },
                            nextAction: 'Read progress with dexto_chat_get.',
                        },
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

    it('suggests a rerun after a lost answer that works past -- and reuses the key', async () => {
        lostAnswers = 1;
        expect(
            await runCloud(host, [
                'chat',
                'continue',
                '--yes',
                '--json',
                '--',
                'chat-review',
                '--help',
            ])
        ).toBe(1);
        const fix: unknown = JSON.parse(stderr).error.fix;
        if (typeof fix !== 'string') throw new Error('Expected a rerun command');
        const [program, ...argv] = fix.split(' ');
        expect(program).toBe('dexto');
        expect(argv.indexOf('--idempotency-key')).toBeLessThan(argv.indexOf('--'));

        stderr = '';
        expect(await runCloud(host, argv)).toBe(0);
        expect(stderr).toBe('');
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({ sessionId: 'chat-review', message: '--help' });
        expect(calls[1]).toEqual(calls[0]);
        expect(JSON.parse(stdout)).toMatchObject({
            replayed: true,
            idempotencyKey: calls[0]?.idempotencyKey,
        });
    });

    it('prints the key it sent in terminal output', async () => {
        expect(
            await runCloud(host, [
                'chat',
                'continue',
                'chat-review',
                'Next step',
                '--yes',
                '--table',
            ])
        ).toBe(0);
        const key = calls[0]?.idempotencyKey;
        expect(key).toMatch(/^cli-/u);
        expect(stdout).toContain(`Idempotency key: ${String(key)}`);
    });
});
