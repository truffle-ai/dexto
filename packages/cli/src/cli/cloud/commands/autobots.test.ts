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
const APPROVAL_ID = '0e9d8c7b-6a5f-4e3d-8c1b-0a9f8e7d6c5b';
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};

const autobot = {
    id: AUTOBOT_ID,
    profile: { name: 'Scout', role: 'Watches competitors' },
    updatedAt: '2026-11-18T00:00:00.000Z',
    visibility: 'private',
};
const statusOf = (waiting: string | null) => ({
    autobot: { id: AUTOBOT_ID, name: 'Scout', agentId: 'agent-1', slug: 'scout' },
    goals: [],
    sessions: [],
    status: 'idle',
    waitingOnUser: waiting === null ? null : { text: waiting },
});

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
            readStdin: async () => '{"profile":{"instructions":"Read the news."}}',
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

    it('lists the AutoBots you can use, with the limit given', async () => {
        replies = [{ autobots: [autobot] }];
        expect(await cli('autobots', 'list', '--limit', '5'), stderr).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_autobots_list', arguments: { limit: 5 } }]);
        expect(output()).toEqual({ data: [autobot], has_more: false, next_after: null });
    });

    it('checks the limit and the sign-in permission before calling the server', async () => {
        expect(await cli('autobots', 'list', '--limit', '51')).toBe(2);
        expect(await cli('autobots', 'status', '--limit', '0')).toBe(2);
        await signIn(['sessions:read']);
        expect(await cli('autobots', 'list')).toBe(3);
        expect(stderr).toContain('--scope autobots:read');
        expect(calls).toEqual([]);
    });

    it('shows one AutoBot, and an AutoBot you cannot use as not found', async () => {
        replies = [
            { autobot },
            {
                error: {
                    code: -32602,
                    message: 'Dexto Autobot was not found.',
                    data: { kind: 'invalid_arguments' },
                },
            },
        ];
        expect(await cli('autobots', 'get', AUTOBOT_ID), stderr).toBe(0);
        expect(output()).toEqual({ autobot });
        expect(await cli('autobots', 'get', AUTOBOT_ID)).toBe(5);
        expect(stderr).toContain('no AutoBot you can use');
        expect(calls.map((call) => call.arguments)).toEqual([
            { autobotId: AUTOBOT_ID },
            { autobotId: AUTOBOT_ID },
        ]);
    });

    it('pages every status with the cursor the server returned', async () => {
        replies = [
            { pagination: { nextCursor: 'c-1' }, statuses: [statusOf('Pick a city')] },
            { pagination: { nextCursor: null }, statuses: [statusOf(null)] },
        ];
        expect(await cli('autobots', 'status', '--limit', '1'), stderr).toBe(0);
        expect(output()).toEqual({
            data: [statusOf('Pick a city')],
            has_more: true,
            next_after: 'c-1',
        });
        stdout = '';
        expect(await cli('autobots', 'status', '--limit', '1', '--after', 'c-1'), stderr).toBe(0);
        expect(output()).toMatchObject({ has_more: false, next_after: null });
        expect(calls).toEqual([
            { name: 'dexto_autobot_status', arguments: { limit: 1 } },
            { name: 'dexto_autobot_status', arguments: { cursor: 'c-1', limit: 1 } },
        ]);
    });

    it("shows one AutoBot's status, never with a cursor", async () => {
        expect(await cli('autobots', 'status', AUTOBOT_ID, '--after', 'c-1')).toBe(2);
        expect(calls).toEqual([]);
        const page = { pagination: { nextCursor: null }, statuses: [statusOf(null)] };
        replies = [page];
        expect(await cli('autobots', 'status', AUTOBOT_ID), stderr).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_autobot_status',
            arguments: { autobotId: AUTOBOT_ID },
        });
        expect(output()).toEqual(page);
    });

    it('asks before saving, and maps flags and JSON onto one save', async () => {
        expect(await cli('autobots', 'save', '--name', 'Scout', '--role', 'Watch')).toBe(4);
        expect(await cli('autobots', 'save', AUTOBOT_ID, '--yes')).toBe(2);
        expect(
            await cli('autobots', 'save', '--data', `{"autobotId":"${AUTOBOT_ID}"}`, '--yes')
        ).toBe(2);
        expect(calls).toEqual([]);
        replies = [
            { autobot, status: 'saved' },
            { autobot, status: 'saved' },
        ];
        expect(
            await cli('autobots', 'save', '--name', 'Scout', '--role', 'Watch', '--yes'),
            stderr
        ).toBe(0);
        expect(
            await cli(
                'autobots',
                'save',
                AUTOBOT_ID,
                '--file',
                '-',
                '--role',
                'Watch closely',
                '--yes'
            ),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_autobot_save',
                arguments: { profile: { name: 'Scout', role: 'Watch' } },
            },
            {
                name: 'dexto_autobot_save',
                arguments: {
                    autobotId: AUTOBOT_ID,
                    profile: { instructions: 'Read the news.', role: 'Watch closely' },
                },
            },
        ]);
    });

    it('publishes only once agreed, with confirm and the distribution', async () => {
        expect(await cli('autobots', 'publish', AUTOBOT_ID, '--yes')).toBe(2);
        expect(
            await cli('autobots', 'publish', AUTOBOT_ID, '--distribution', 'everyone', '--yes')
        ).toBe(2);
        expect(await cli('autobots', 'publish', AUTOBOT_ID, '--distribution', 'public')).toBe(4);
        expect(calls).toEqual([]);
        replies = [{ status: 'published', release: { version: 2 } }];
        expect(
            await cli('autobots', 'publish', AUTOBOT_ID, '--distribution', 'unlisted', '--yes'),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_autobot_publish',
            arguments: { autobotId: AUTOBOT_ID, distribution: 'unlisted', confirm: true },
        });
    });

    it('stops for consent when its Skills would publish too, and needs skills:write for them', async () => {
        const asked = {
            message: 'Publishing also publishes 1 Skill.',
            skillsToPublish: [{ id: 'skill-1' }],
            status: 'confirmation_required',
        };
        replies = [asked];
        expect(
            await cli('autobots', 'publish', AUTOBOT_ID, '--distribution', 'public', '--yes')
        ).toBe(4);
        expect(output()).toEqual(asked);
        expect(stderr).toContain('--publish-skills');
        expect(
            await cli(
                'autobots',
                'publish',
                AUTOBOT_ID,
                '--distribution',
                'public',
                '--publish-skills',
                '--yes'
            )
        ).toBe(3);
        expect(stderr).toContain('skills:write');
        await signIn(['autobots:write', 'skills:write']);
        replies = [{ status: 'published' }];
        expect(
            await cli(
                'autobots',
                'publish',
                AUTOBOT_ID,
                '--distribution',
                'public',
                '--publish-skills',
                '--yes'
            ),
            stderr
        ).toBe(0);
        expect(calls.map((call) => call.arguments)).toEqual([
            { autobotId: AUTOBOT_ID, distribution: 'public', confirm: true },
            {
                autobotId: AUTOBOT_ID,
                distribution: 'public',
                publishSelectedSkills: true,
                confirm: true,
            },
        ]);
    });

    it('sends input answers only as an object, once agreed', async () => {
        expect(await cli('autobots', 'input', APPROVAL_ID, '--yes')).toBe(2);
        expect(await cli('autobots', 'input', APPROVAL_ID, '--data', '[1]', '--yes')).toBe(2);
        expect(await cli('autobots', 'input', APPROVAL_ID, '--data', '{"city":"Paris"}')).toBe(4);
        expect(calls).toEqual([]);
        const submitted = {
            approvalId: APPROVAL_ID,
            runId: 'run-1',
            sessionId: 'chat-1',
            status: 'approved',
        };
        replies = [submitted];
        expect(
            await cli('autobots', 'input', APPROVAL_ID, '--data', '{"city":"Paris"}', '--yes'),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_autobot_input_submit',
            arguments: { approvalId: APPROVAL_ID, formData: { city: 'Paris' }, confirm: true },
        });
        expect(output()).toEqual(submitted);
    });

    it('messages an AutoBot in your own conversation with it', async () => {
        const session = { id: 'chat-3', url: 'https://app.dexto.ai/c/3', message: 'Hi' };
        replies = [{ autobotId: AUTOBOT_ID, session }];
        expect(
            await cli('autobots', 'chat', AUTOBOT_ID, 'What changed?', '--title', 'Weekly'),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_autobot_chat_start',
            arguments: { autobotId: AUTOBOT_ID, message: 'What changed?', title: 'Weekly' },
        });
        expect(output()).toEqual({ autobotId: AUTOBOT_ID, session });
    });
});
