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
const AUTOBOT_ID = '6b1f3c2e-4a5d-4e8f-9a0b-1c2d3e4f5a6b';
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};

const autobot = {
    address: `agent:autobots:${AUTOBOT_ID}`,
    avatar: 'round-teal-crown-none',
    conversationSessionId: 'chat-1',
    createdAt: '2026-11-18T00:00:00.000Z',
    goal: null,
    id: AUTOBOT_ID,
    name: 'Release Manager',
    role: 'Keeps your code moving from review to release.',
    starters: [],
    template: null,
    updatedAt: '2026-11-18T00:00:00.000Z',
    waitingOnYou: true,
};

/** A refusal as the Dexto MCP sends it: a JSON-RPC error with its kind. */
interface Refusal {
    readonly error: { code: number; message: string; data: { kind: string } };
}

describe('AutoBots over the Dexto MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: unknown }[];
    let replies: (Refusal | Record<string, unknown>)[];
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
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-autobots-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        await signIn(['autobots:read', 'autobots:write']);
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
                if ('error' in reply)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: reply.error });
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

    it('lists the AutoBots you hired', async () => {
        replies = [{ autobots: [autobot] }];
        expect(await cli('autobots', 'list'), stderr).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_autobots_list', arguments: {} }]);
        expect(output()).toEqual({ data: [autobot] });
    });

    it('checks the sign-in permission before calling the server', async () => {
        await signIn(['sessions:read']);
        expect(await cli('autobots', 'list')).toBe(3);
        expect(stderr).toContain('--scope autobots:read');
        expect(calls).toEqual([]);
    });

    it('shows one AutoBot, and one you did not hire as not found with where to look', async () => {
        replies = [
            { autobot },
            {
                error: {
                    code: -32602,
                    message: 'AutoBot not found.',
                    data: { kind: 'not_found' },
                },
            },
        ];
        expect(await cli('autobots', 'get', AUTOBOT_ID), stderr).toBe(0);
        expect(output()).toEqual({ autobot });
        expect(await cli('autobots', 'get', AUTOBOT_ID)).toBe(5);
        expect(stderr).toContain('dexto autobots list');
        expect(calls.map((call) => call.arguments)).toEqual([
            { autobotId: AUTOBOT_ID },
            { autobotId: AUTOBOT_ID },
        ]);
    });

    it('hires from a publisher/slug template only once agreed', async () => {
        expect(await cli('autobots', 'hire', 'release-manager', '--yes')).toBe(2);
        expect(await cli('autobots', 'hire', 'dexto/release-manager')).toBe(4);
        expect(calls).toEqual([]);
        replies = [{ autobot }, { autobot }];
        expect(await cli('autobots', 'hire', 'dexto/release-manager', '--yes'), stderr).toBe(0);
        expect(await cli('autobots', 'hire', '@acme/scout', '--yes'), stderr).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_autobot_hire',
                arguments: { publisherHandle: 'dexto', templateSlug: 'release-manager' },
            },
            {
                name: 'dexto_autobot_hire',
                arguments: { publisherHandle: 'acme', templateSlug: 'scout' },
            },
        ]);
    });

    it('messages an AutoBot at its address, steering unless --follow-up', async () => {
        await signIn(['autobots:read', 'autobots:write', 'sessions:write']);
        expect(await cli('autobots', 'chat', AUTOBOT_ID, ' ', '--yes')).toBe(2);
        expect(await cli('autobots', 'chat', AUTOBOT_ID, 'What changed?')).toBe(4);
        expect(calls).toEqual([]);
        const sent = { session: { id: 'chat-1' }, status: 'queued' };
        replies = [sent, sent];
        expect(await cli('autobots', 'chat', AUTOBOT_ID, 'What changed?', '--yes'), stderr).toBe(0);
        expect(
            await cli('autobots', 'chat', AUTOBOT_ID, 'Then the notes.', '--follow-up', '--yes'),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_chat_send',
                arguments: {
                    sessionId: `agent:autobots:${AUTOBOT_ID}`,
                    message: 'What changed?',
                    queue: 'steer',
                },
            },
            {
                name: 'dexto_chat_send',
                arguments: {
                    sessionId: `agent:autobots:${AUTOBOT_ID}`,
                    message: 'Then the notes.',
                    queue: 'follow-up',
                },
            },
        ]);
    });
});
