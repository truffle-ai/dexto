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

const CONVERSATION_ID = '5b1c2d3e-4f50-4a61-8b72-9c83d4e5f601';
const ROOT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const conversation = {
    id: CONVERSATION_ID,
    createdAt: '2026-11-20T09:00:00.000Z',
    readSequence: 3,
    lastSequence: 7,
    unread: true,
    unreadCount: 4,
    lastActivityAt: '2026-11-24T10:00:00.000Z',
    external: false,
    participants: [{ userId: 'u2', displayName: 'Ada', avatarUrl: null }],
};
const page = {
    untrustedContent: true,
    conversationId: CONVERSATION_ID,
    title: null,
    messages: [
        {
            id: ROOT_ID,
            authorName: 'Ada',
            text: 'Can you look at the release?',
            sequence: 7,
            nextTextOffset: 8000,
        },
    ],
    previousCursor: 7,
    nextCursor: null,
    threadRoot: null,
    files: [],
};

/** A reply the fake MCP sends: a tool's structured result, or a JSON-RPC refusal. */
type Reply = { value: unknown } | { error: { code: number; message: string; data?: unknown } };

describe('dexto messages over the Dexto MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let replies: Reply[];
    let terminal: boolean;
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
        return await runCloud(host, terminal ? args : [...args, '--json']);
    }

    const output = () => JSON.parse(stdout);

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-messages-')), 'accounts');
        stdout = '';
        stderr = '';
        terminal = false;
        calls = [];
        replies = [];
        await signIn(['messages:read']);
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
                              result: { content: [], structuredContent: reply.value },
                          }
                );
            },
            prompt: null,
            readStdin: async () => '',
            runProcess: async () => ({ exitCode: 0, output: '' }),
            signal: new AbortController().signal,
            sleep: async () => undefined,
            get stdoutIsTerminal() {
                return terminal;
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
            signInForScopes: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('lists direct conversations as the tool returns them', async () => {
        replies = [{ value: { conversations: [conversation] } }];
        expect(await cli('messages', 'list'), stderr).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_direct_conversations_list', arguments: {} }]);
        expect(output()).toEqual({ data: [conversation] });
    });

    it('lists none as an empty list', async () => {
        replies = [{ value: { conversations: [] } }];
        expect(await cli('messages', 'list'), stderr).toBe(0);
        expect(output()).toEqual({ data: [] });
    });

    it('shows who each conversation is with, for people', async () => {
        terminal = true;
        replies = [{ value: { conversations: [conversation] } }];
        expect(await cli('messages', 'list'), stderr).toBe(0);
        expect(stdout).toContain(CONVERSATION_ID);
        expect(stdout).toContain('Ada');
    });

    it('reads a reply thread with its cursors with one read call, and prints the page unchanged', async () => {
        replies = [{ value: page }];
        expect(
            await cli(
                'messages',
                'read',
                CONVERSATION_ID,
                '--thread',
                ROOT_ID,
                '--after',
                '2',
                '--text-offset',
                '8000'
            ),
            stderr
        ).toBe(0);
        // The only call is the read-only tool: nothing is marked read.
        expect(calls).toEqual([
            {
                name: 'dexto_direct_conversation_get',
                arguments: {
                    conversationId: CONVERSATION_ID,
                    after: 2,
                    textOffset: 8000,
                    threadRootMessageId: ROOT_ID,
                },
            },
        ]);
        expect(output()).toEqual(page);
    });

    it('prints messages, the rest of a long one and the older cursor for people', async () => {
        terminal = true;
        replies = [{ value: page }];
        expect(await cli('messages', 'read', CONVERSATION_ID, '--before', '9'), stderr).toBe(0);
        expect(calls[0]?.arguments).toEqual({ conversationId: CONVERSATION_ID, before: 9 });
        expect(stdout).toContain(`Ada (${ROOT_ID}):\nCan you look at the release?`);
        expect(stderr).toContain('--text-offset 8000');
        expect(stderr).toContain('--before 7');
    });

    it('prints an empty conversation as no messages', async () => {
        terminal = true;
        replies = [{ value: { ...page, messages: [], previousCursor: null } }];
        expect(await cli('messages', 'read', CONVERSATION_ID), stderr).toBe(0);
        expect(stdout).toBe('No messages.\n');
    });

    it('refuses --before with --after, and a cursor that is not a number, without calling', async () => {
        expect(
            await cli('messages', 'read', CONVERSATION_ID, '--before', '3', '--after', '1')
        ).toBe(2);
        expect(await cli('messages', 'read', CONVERSATION_ID, '--before', 'older')).toBe(2);
        expect(await cli('messages', 'read')).toBe(2);
        expect(calls).toEqual([]);
    });

    it('reports a conversation the person is not in, or of another organization, as not found', async () => {
        replies = [
            {
                error: {
                    code: -32004,
                    message: 'Direct conversation not found.',
                    data: { kind: 'not_found' },
                },
            },
        ];
        expect(await cli('messages', 'read', CONVERSATION_ID)).not.toBe(0);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'Direct conversation not found.',
        });
    });

    it('needs messages:read before calling', async () => {
        await signIn([]);
        expect(await cli('messages', 'list')).toBe(3);
        expect(stderr).toContain('messages:read');
        stderr = '';
        expect(await cli('messages', 'read', CONVERSATION_ID)).toBe(3);
        expect(stderr).toContain('messages:read');
        expect(calls).toEqual([]);
    });
});
