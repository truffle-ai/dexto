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

const CHANNEL_ID = '3f2a1b0c-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ROOT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const channel = {
    id: CHANNEL_ID,
    title: 'Releases',
    visibility: 'organization',
    role: 'member',
    state: 'active',
    unread: true,
};
const page = {
    untrustedContent: true,
    channelId: CHANNEL_ID,
    title: 'Releases',
    messages: [
        {
            id: ROOT_ID,
            authorName: 'Ada',
            text: 'Shipped 2.1.',
            sequence: 7,
            nextTextOffset: null,
        },
    ],
    previousCursor: 7,
    nextCursor: null,
    threadRoot: null,
    threads: [],
    files: [],
};

/** A reply the fake MCP sends: a tool's structured result, or a JSON-RPC refusal. */
type Reply = { value: unknown } | { error: { code: number; message: string; data?: unknown } };

describe('dexto channels over the Dexto MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let replies: Reply[];
    let stdin: string;
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
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-channels-')), 'accounts');
        stdout = '';
        stderr = '';
        stdin = '';
        terminal = false;
        calls = [];
        replies = [];
        await signIn(['messages:read', 'messages:write']);
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
            readStdin: async () => stdin,
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

    it('lists channels as the tool returns them', async () => {
        replies = [{ value: { channels: [channel] } }];
        expect(await cli('channels', 'list'), stderr).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_channels_list', arguments: {} }]);
        expect(output()).toEqual({ data: [channel] });
    });

    it('reads a reply thread with its cursors and prints the page unchanged', async () => {
        replies = [{ value: page }];
        expect(
            await cli(
                'channels',
                'read',
                CHANNEL_ID,
                '--thread',
                ROOT_ID,
                '--before',
                '9',
                '--text-offset',
                '8000'
            ),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_channel_get',
                arguments: {
                    channelId: CHANNEL_ID,
                    before: 9,
                    textOffset: 8000,
                    threadRootMessageId: ROOT_ID,
                },
            },
        ]);
        expect(output()).toEqual(page);
    });

    it('prints messages and the next cursor for people', async () => {
        terminal = true;
        replies = [{ value: page }];
        expect(await cli('channels', 'read', CHANNEL_ID), stderr).toBe(0);
        expect(stdout).toContain(`Ada (${ROOT_ID}):\nShipped 2.1.`);
        expect(stderr).toContain('--before 7');
    });

    it('refuses --before with --after, and a cursor that is not a number, without calling', async () => {
        expect(await cli('channels', 'read', CHANNEL_ID, '--before', '3', '--after', '1')).toBe(2);
        expect(await cli('channels', 'read', CHANNEL_ID, '--after', 'next')).toBe(2);
        expect(calls).toEqual([]);
    });

    it('reports a channel the person is not in as not found', async () => {
        replies = [
            {
                error: {
                    code: -32004,
                    message: 'Channel not found.',
                    data: { kind: 'not_found' },
                },
            },
        ];
        expect(await cli('channels', 'read', CHANNEL_ID)).not.toBe(0);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'Channel not found.',
        });
    });

    it('asks before sending, then sends the exact text once agreed with one request key', async () => {
        expect(await cli('channels', 'send', CHANNEL_ID, 'Shipped.')).toBe(4);
        expect(calls).toEqual([]);
        replies = [{ value: { accepted: true, channelId: CHANNEL_ID, messageId: 'm1' } }];
        expect(
            await cli(
                'channels',
                'send',
                CHANNEL_ID,
                '  Shipped.  ',
                '--thread',
                ROOT_ID,
                '--as',
                'user',
                '--yes'
            ),
            stderr
        ).toBe(0);
        const [sent] = calls;
        const requestKey = sent?.arguments.requestKey;
        expect(typeof requestKey).toBe('string');
        expect(sent).toEqual({
            name: 'dexto_channel_send',
            arguments: {
                channelId: CHANNEL_ID,
                text: '  Shipped.  ',
                requestKey,
                sendAs: 'user',
                threadRootMessageId: ROOT_ID,
                confirm: true,
            },
        });
        expect(output()).toEqual({
            accepted: true,
            channelId: CHANNEL_ID,
            messageId: 'm1',
            requestKey,
        });
        expect(stderr).toContain(`Request key: ${String(requestKey)}`);
    });

    it('prints the request key before a send whose response is lost', async () => {
        expect(await cli('channels', 'send', CHANNEL_ID, 'Shipped.', '--yes')).not.toBe(0);
        const requestKey = calls[0]?.arguments.requestKey;
        expect(typeof requestKey).toBe('string');
        expect(stderr).toContain(`Request key: ${String(requestKey)}`);
    });

    it('retries a lost send with the same request key, so Dexto returns the first message', async () => {
        const send = ['channels', 'send', CHANNEL_ID, 'Shipped.', '--request-key', 'k1', '--yes'];
        const accepted = { accepted: true, channelId: CHANNEL_ID, messageId: 'm1' };
        replies = [{ value: accepted }, { value: accepted }];
        expect(await cli(...send), stderr).toBe(0);
        stdout = '';
        expect(await cli(...send), stderr).toBe(0);
        expect(calls.map((call) => call.arguments.requestKey)).toEqual(['k1', 'k1']);
        expect(output().messageId).toBe('m1');
    });

    it('sends stdin for -, and shows the call without sending on --dry-run', async () => {
        stdin = 'From a pipe\n';
        expect(
            await cli('channels', 'send', CHANNEL_ID, '-', '--request-key', 'k2', '--dry-run')
        ).toBe(0);
        expect(calls).toEqual([]);
        expect(output()).toEqual({
            dryRun: true,
            tool: 'dexto_channel_send',
            arguments: { channelId: CHANNEL_ID, text: 'From a pipe\n', requestKey: 'k2' },
        });
    });

    it('checks the text, sender and permission before calling', async () => {
        const send = ['channels', 'send', CHANNEL_ID];
        expect(await cli(...send, '   ', '--yes')).toBe(2);
        expect(await cli(...send, 'Hi', '--as', 'project', '--yes')).toBe(2);
        await signIn(['messages:read']);
        expect(await cli(...send, 'Hi', '--yes')).toBe(3);
        expect(stderr).toContain('messages:write');
        stderr = '';
        await signIn([]);
        expect(await cli('channels', 'list')).toBe(3);
        expect(stderr).toContain('messages:read');
        expect(calls).toEqual([]);
    });
});
