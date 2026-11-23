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

describe('dexto chat fork', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: Record<string, unknown>[];
    let host: CloudHost;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-chat-fork-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
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
                if (message.method !== 'tools/call' || message.params.name !== 'dexto_chat_fork')
                    throw new Error('Unexpected MCP call');
                const args = message.params.arguments;
                calls.push(args);
                const reason =
                    args.sessionId === 'running'
                        ? 'This chat has an active run. Cancel it or wait for it to finish, then fork.'
                        : args.sessionId === 'coordinator'
                          ? "A Project's coordinator conversation can't be forked."
                          : null;
                return Response.json(
                    reason === null
                        ? {
                              jsonrpc: '2.0',
                              id: message.id,
                              result: {
                                  structuredContent: {
                                      session: {
                                          id: 'fork-1',
                                          title: 'Forked chat',
                                          url: 'https://app.dexto.ai/chat/fork-1',
                                      },
                                  },
                              },
                          }
                        : {
                              jsonrpc: '2.0',
                              id: message.id,
                              error: { code: -32009, message: reason, data: { kind: 'conflict' } },
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

    it('parses --message and prints the fork identity', async () => {
        expect(
            await runCloud(host, [
                'chat',
                'fork',
                'chat-1',
                '--message',
                'msg-2',
                '--yes',
                '--table',
            ])
        ).toBe(0);
        expect(calls).toEqual([{ sessionId: 'chat-1', messageId: 'msg-2' }]);
        expect(stdout).toContain('Forked chat');
        expect(stdout).toContain('fork-1');
        expect(stdout).toContain('https://app.dexto.ai/chat/fork-1');
    });

    it('requires --yes without a terminal and sends nothing', async () => {
        expect(await runCloud(host, ['chat', 'fork', 'chat-1', '--json'])).toBe(4);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'needs_confirmation',
            message: expect.stringContaining('--yes'),
        });
        expect(calls).toEqual([]);
    });

    it.each([
        ['running', 'Cancel it or wait'],
        ['coordinator', "coordinator conversation can't be forked"],
    ])('returns the %s refusal and nonzero exit', async (id, hint) => {
        expect(await runCloud(host, ['chat', 'fork', id, '--yes', '--json'])).toBe(1);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'failed',
            message: expect.stringContaining(hint),
        });
        expect(calls).toEqual([{ sessionId: id }]);
    });
});
