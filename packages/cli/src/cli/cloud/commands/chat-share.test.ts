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
const CHAT_ID = '6f1c2a4e-8b3d-4c5a-9e7f-1a2b3c4d5e6f';
const TEAMMATE_CHAT_ID = '33333333-3333-4333-8333-333333333333';

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto chat share', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let questions: string[];
    let answer: string | null;
    let calls: Record<string, unknown>[];
    let host: CloudHost;

    /** dexto_chat_share as the server answers it: it finds only the caller's own chats. */
    const reply = (id: number, args: Record<string, unknown>) => {
        if (args.confirm !== true)
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32001,
                    message: 'Confirm this call first.',
                    data: { kind: 'needs_confirmation', level: 'approve' },
                },
            };
        if (args.sessionId === TEAMMATE_CHAT_ID)
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
                structuredContent: { access: args.access, sessionId: args.sessionId },
            },
        };
    };

    const signIn = (scopes: string[]) =>
        dextoAccounts.writeLogin(dir, 'default', {
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

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-chat-share-')), 'accounts');
        stdout = '';
        stderr = '';
        questions = [];
        answer = null;
        calls = [];
        await signIn(['sessions:read', 'sessions:write']);
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
                if (message.method !== 'tools/call' || message.params.name !== 'dexto_chat_share')
                    throw new Error(`Unexpected MCP call ${message.method}.`);
                calls.push(message.params.arguments);
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

    it.each(['private', 'view', 'prompt'])(
        'sets %s access once agreed with --yes, passing confirm',
        async (access) => {
            expect(
                await runCloud(host, ['chat', 'share', CHAT_ID, access, '--yes', '--json'])
            ).toBe(0);
            expect(calls).toEqual([{ sessionId: CHAT_ID, access, confirm: true }]);
            expect(JSON.parse(stdout)).toEqual({ access, session_id: CHAT_ID });
        }
    );

    it('asks first without --yes and changes nothing, naming the credits for prompt', async () => {
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, 'prompt'])).toBe(4);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('needs_confirmation');
        expect(error.message).toContain("use your organization's credits");
        expect(error.fix).toContain('--yes');
        expect(calls).toEqual([]);

        stderr = '';
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, 'view'])).toBe(4);
        expect(JSON.parse(stderr).error.message).not.toContain('credits');
        expect(calls).toEqual([]);
    });

    it('asks at a terminal, with the credits note for prompt, and shares once agreed', async () => {
        answer = 'y';
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, 'prompt', '--table'])).toBe(0);
        expect(questions).toHaveLength(1);
        expect(questions[0]).toContain('every member can open it and send messages');
        expect(questions[0]).toContain("use your organization's credits");
        expect(calls).toEqual([{ sessionId: CHAT_ID, access: 'prompt', confirm: true }]);
        expect(stdout).toContain(
            `Chat ${CHAT_ID} is now shared with your organization: members can view it and send messages.`
        );
    });

    it('makes no change when the person declines at the terminal', async () => {
        answer = 'n';
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, 'private'])).toBe(4);
        expect(questions[0]).toContain(`Make chat ${CHAT_ID} private`);
        expect(calls).toEqual([]);
    });

    it("fails clearly for a chat the caller doesn't own", async () => {
        expect(
            await runCloud(host, ['chat', 'share', TEAMMATE_CHAT_ID, 'view', '--yes', '--json'])
        ).toBe(5);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('not_found');
        expect(error.message).toBe(
            `You have no chat ${TEAMMATE_CHAT_ID}. Only a chat's owner can share it.`
        );
        expect(stdout).toBe('');
    });

    it('refuses an access level other than private, view or prompt', async () => {
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, 'public', '--yes'])).toBe(2);
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, '--yes'])).toBe(2);
        expect(calls).toEqual([]);
    });

    it('shows the call with --dry-run, without asking or making it', async () => {
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, 'view', '--dry-run'])).toBe(0);
        expect(JSON.parse(stdout)).toEqual({
            dry_run: true,
            tool: 'dexto_chat_share',
            arguments: { sessionId: CHAT_ID, access: 'view' },
        });
        expect(calls).toEqual([]);
    });

    it('needs sessions:write before it asks', async () => {
        await signIn(['sessions:read']);
        answer = 'y';
        expect(await runCloud(host, ['chat', 'share', CHAT_ID, 'view'])).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('sessions:write');
        expect(questions).toEqual([]);
        expect(calls).toEqual([]);
    });
});
