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
const PROJECT_ID = '3f0c9a52-1b7e-4c1a-9d55-0a4f7e2b8c11';
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};

const project = {
    id: PROJECT_ID,
    name: 'Roadmap',
    description: null,
    coordinator: { conversationSessionId: null, dailyChatCap: 10, startPolicy: 'start' },
    pinnedAt: null,
    updatedAt: '2026-11-10T00:00:00.000Z',
};

describe('projects over the Dexto MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: unknown }[];
    let replies: unknown[];
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
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-projects-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        await signIn(['projects:read', 'projects:write', 'sessions:write']);
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
                const value = replies.shift();
                if (value === undefined) throw new Error('Unexpected MCP call');
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: { content: [], structuredContent: value },
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
            signInForScope: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('lists Projects with the filters it was given', async () => {
        replies = [{ projects: [project] }];
        expect(
            await cli('projects', 'list', '--query', 'road', '--imported-from', 'codex'),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            { name: 'dexto_projects_list', arguments: { query: 'road', importedFrom: 'codex' } },
        ]);
        expect(output()).toEqual({ data: [project] });
    });

    it('checks filters and the sign-in permission before calling the server', async () => {
        expect(await cli('projects', 'list', '--imported-from', 'cursor')).toBe(2);
        await signIn(['sessions:read']);
        expect(await cli('projects', 'list')).toBe(3);
        expect(stderr).toContain('--scope projects:read');
        expect(calls).toEqual([]);
    });

    it('shows one Project by id or link', async () => {
        replies = [{ project, folder: null, untrustedContent: true }];
        expect(await cli('projects', 'get', PROJECT_ID), stderr).toBe(0);
        expect(calls[0]).toEqual({ name: 'dexto_project_get', arguments: { project: PROJECT_ID } });
        expect(output().project.id).toBe(PROJECT_ID);
    });

    it('asks before creating a Project and creates it with --yes', async () => {
        expect(await cli('projects', 'create', 'Roadmap')).toBe(4);
        expect(stderr).toContain('--yes');
        expect(calls).toEqual([]);
        replies = [{ project }];
        expect(
            await cli('projects', 'create', 'Roadmap', '--description', 'Plans', '--yes'),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_project_create',
                arguments: { name: 'Roadmap', description: 'Plans' },
            },
        ]);
        expect(output()).toEqual({ project });
    });

    it('updates only the fields named, and refuses an empty or out-of-range update', async () => {
        expect(await cli('projects', 'update', PROJECT_ID, '--yes')).toBe(2);
        expect(await cli('projects', 'update', PROJECT_ID, '--daily-cap', '0', '--yes')).toBe(2);
        expect(await cli('projects', 'update', PROJECT_ID, '--pin', '--unpin', '--yes')).toBe(2);
        expect(calls).toEqual([]);
        replies = [{ project }];
        expect(
            await cli(
                'projects',
                'update',
                PROJECT_ID,
                '--start-policy',
                'propose',
                '--daily-cap',
                '5',
                '--clear-description',
                '--pin',
                '--yes'
            ),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_project_update',
            arguments: {
                project: PROJECT_ID,
                coordinatorStartPolicy: 'propose',
                coordinatorDailyChatCap: 5,
                description: null,
                pinned: true,
            },
        });
    });

    it('deletes only with an explicit choice for its chats', async () => {
        expect(await cli('projects', 'delete', PROJECT_ID, '--yes')).toBe(2);
        expect(await cli('projects', 'delete', PROJECT_ID, '--chats', 'delete')).toBe(4);
        expect(calls).toEqual([]);
        replies = [{ project, chatDisposition: 'keep' }];
        expect(
            await cli('projects', 'delete', PROJECT_ID, '--chats', 'keep', '--yes'),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_project_delete',
            arguments: { project: PROJECT_ID, chatDisposition: 'keep' },
        });
    });

    it('moves a chat into a Project, or out of it with --out', async () => {
        expect(await cli('projects', 'move', 'chat-1', '--yes')).toBe(2);
        expect(await cli('projects', 'move', 'chat-1', PROJECT_ID, '--out', '--yes')).toBe(2);
        replies = [
            { chat: { id: 'chat-1', project: PROJECT_ID, title: null } },
            { chat: { id: 'chat-1', project: null, title: null } },
        ];
        expect(await cli('projects', 'move', 'chat-1', PROJECT_ID, '--yes'), stderr).toBe(0);
        expect(await cli('projects', 'move', 'chat-1', '--out', '--yes'), stderr).toBe(0);
        expect(calls.map((call) => call.arguments)).toEqual([
            { chat: 'chat-1', project: PROJECT_ID },
            { chat: 'chat-1', project: null },
        ]);
    });

    it('starts a Project chat from a brief', async () => {
        const session = {
            id: 'chat-2',
            title: 'Fix it',
            url: 'https://app.dexto.ai/c/2',
            status: 'running',
        };
        replies = [{ session }];
        expect(
            await cli('projects', 'start', PROJECT_ID, 'Fix the bug', '--title', 'Fix it'),
            stderr
        ).toBe(0);
        expect(calls[0]).toEqual({
            name: 'dexto_project_chat_start',
            arguments: { project: PROJECT_ID, message: 'Fix the bug', title: 'Fix it' },
        });
        expect(output()).toEqual({ session });
    });

    it('exits 6 with the proposal when the Project only proposes chats', async () => {
        const proposal = { status: 'proposed', proposal: { message: 'Fix' }, nextAction: 'say so' };
        replies = [proposal];
        expect(await cli('projects', 'start', PROJECT_ID, 'Fix')).toBe(6);
        expect(output()).toEqual(proposal);
        expect(stderr + stdout).toContain('proposes chats first');
    });

    it("messages the Project's coordinator through its link, steering by default", async () => {
        expect(await cli('projects', 'run', PROJECT_ID, 'Plan the week')).toBe(4);
        expect(calls).toEqual([]);
        replies = [{ queued: true }, { queued: true }];
        expect(await cli('projects', 'run', PROJECT_ID, 'Plan the week', '--yes'), stderr).toBe(0);
        expect(
            await cli('projects', 'run', PROJECT_ID, 'After that', '--follow-up', '--yes'),
            stderr
        ).toBe(0);
        const link = `https://app.dexto.ai/desktop/apps/chat/projects/${PROJECT_ID}`;
        expect(calls.map((call) => call.arguments)).toEqual([
            { sessionId: link, message: 'Plan the week', queue: 'steer' },
            { sessionId: link, message: 'After that', queue: 'follow-up' },
        ]);
    });
});
