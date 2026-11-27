import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const deleteLocalChat = vi.hoisted(() => vi.fn());
vi.mock('../../chat-sync/node.js', () => ({
    nodeChatSync: () => ({ deleteLocalChat }),
}));

const MCP = 'https://app.dexto.ai/mcp';

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto chat delete', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let questions: string[];
    let answer: string | null;
    let calls: { args: Record<string, unknown>; authorization: string | null }[];
    let localChats: Set<string>;
    let deletedLocally: string[];
    let host: CloudHost;

    /** dexto_chat_delete as the server answers it: it finds only the caller's own chats. */
    const reply = (id: number, args: Record<string, unknown>) => {
        if (args.sessionId !== 'chat-1')
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32004,
                    message: 'Dexto session was not found.',
                    data: { kind: 'not_found' },
                },
            };
        return {
            jsonrpc: '2.0',
            id,
            result: {
                content: [{ type: 'text', text: 'ok' }],
                structuredContent: { deleted: true, sessionId: 'chat-1' },
            },
        };
    };

    const signIn = (profile: string, accessToken: string, scopes: string[]) =>
        dextoAccounts.writeLogin(dir, profile, {
            kind: 'oauth',
            accessToken,
            refreshToken: `refresh-${profile}`,
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

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-chat-delete-')), 'accounts');
        stdout = '';
        stderr = '';
        questions = [];
        answer = null;
        calls = [];
        localChats = new Set(['local-1']);
        deletedLocally = [];
        deleteLocalChat.mockReset();
        deleteLocalChat.mockResolvedValue('deleted');
        await signIn('default', 'access-default', ['sessions:read', 'sessions:write']);
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
                if (message.method !== 'tools/call' || message.params.name !== 'dexto_chat_delete')
                    throw new Error(`Unexpected MCP call ${message.method}.`);
                calls.push({
                    args: message.params.arguments,
                    authorization: request.headers.get('authorization'),
                });
                return Response.json(reply(message.id, message.params.arguments));
            },
            get prompt() {
                if (answer === null) return null;
                const given = answer;
                return async (question: string) => {
                    questions.push(question);
                    return given;
                };
            },
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
        const agent = {
            getSessionMetadata: async (id: string) =>
                localChats.has(id) ? { lastActivity: 0, messageCount: 1 } : undefined,
            deleteSession: async (id: string) => {
                deletedLocally.push(id);
                localChats.delete(id);
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
            openLocalAgent: async () => agent as never,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('deletes your cloud chat with --yes --json over dexto_chat_delete', async () => {
        expect(await runCloud(host, ['chat', 'delete', 'chat-1', '--yes', '--json'])).toBe(0);
        expect(calls.map((call) => call.args)).toEqual([{ sessionId: 'chat-1' }]);
        expect(JSON.parse(stdout)).toEqual({
            deleted: true,
            location: 'cloud',
            sessionId: 'chat-1',
        });
        expect(deletedLocally).toEqual([]);
    });

    it('deletes with the --profile sign-in, leaving the default profile alone', async () => {
        await signIn('second', 'access-second', ['sessions:read', 'sessions:write']);
        expect(
            await runCloud(host, [
                'chat',
                'delete',
                'chat-1',
                '--profile',
                'second',
                '--yes',
                '--json',
            ])
        ).toBe(0);
        expect(calls.map((call) => call.authorization)).toEqual(['Bearer access-second']);
        expect(await dextoAccounts.readCurrentProfile(dir)).toBe('default');
    });

    it('asks first without --yes and deletes nothing', async () => {
        expect(await runCloud(host, ['chat', 'delete', 'chat-1', '--json'])).toBe(4);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('needs_confirmation');
        expect(error.message).toContain("can't be undone");
        expect(error.fix).toContain('--yes');
        expect(calls).toEqual([]);
    });

    it('asks at a terminal and deletes once agreed, or not when declined', async () => {
        answer = 'n';
        expect(await runCloud(host, ['chat', 'delete', 'chat-1', '--table'])).toBe(4);
        expect(calls).toEqual([]);

        answer = 'y';
        expect(await runCloud(host, ['chat', 'delete', 'chat-1', '--table'])).toBe(0);
        expect(questions).toHaveLength(2);
        expect(questions[1]).toContain('chat-1');
        expect(calls.map((call) => call.args)).toEqual([{ sessionId: 'chat-1' }]);
        expect(stdout).toContain('Deleted chat chat-1.');
    });

    it('fails with a JSON not_found for an unknown chat or one you do not own', async () => {
        expect(await runCloud(host, ['chat', 'delete', 'teammate-chat', '--yes', '--json'])).toBe(
            5
        );
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('not_found');
        expect(error.message).toContain('You have no cloud chat teammate-chat.');
        expect(error.fix).toBe('dexto chat delete teammate-chat --local --yes');
        expect(stdout).toBe('');
    });

    it('shows the call with --dry-run, without asking or making it', async () => {
        expect(await runCloud(host, ['chat', 'delete', 'chat-1', '--dry-run'])).toBe(0);
        expect(JSON.parse(stdout)).toEqual({
            dryRun: true,
            tool: 'dexto_chat_delete',
            arguments: { sessionId: 'chat-1' },
        });
        expect(calls).toEqual([]);
    });

    it('needs sessions:write before it asks', async () => {
        await signIn('default', 'access-default', ['sessions:read']);
        answer = 'y';
        expect(await runCloud(host, ['chat', 'delete', 'chat-1'])).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('sessions:write');
        expect(questions).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("deletes a chat on this machine with --local, and its synced copy, without Dexto's MCP", async () => {
        expect(
            await runCloud(host, ['chat', 'delete', 'local-1', '--local', '--yes', '--json'])
        ).toBe(0);
        expect(deletedLocally).toEqual(['local-1']);
        expect(deleteLocalChat).toHaveBeenCalledWith('local-1');
        expect(calls).toEqual([]);
        expect(JSON.parse(stdout)).toEqual({
            deleted: true,
            location: 'local',
            sessionId: 'local-1',
            cloudCopy: 'deleted',
        });
    });

    it('fails with not_found for --local when this machine has no such chat', async () => {
        expect(
            await runCloud(host, ['chat', 'delete', 'chat-1', '--local', '--yes', '--json'])
        ).toBe(5);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('not_found');
        expect(error.fix).toBe('dexto chat delete chat-1 --yes');
        expect(deletedLocally).toEqual([]);
        expect(deleteLocalChat).not.toHaveBeenCalled();
    });

    it('asks first for --local too', async () => {
        expect(await runCloud(host, ['chat', 'delete', 'local-1', '--local', '--json'])).toBe(4);
        expect(deletedLocally).toEqual([]);
    });
});
