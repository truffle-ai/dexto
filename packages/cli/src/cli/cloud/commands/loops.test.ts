import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { builtCloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const AGENT = '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80';
const PROJECT = '0b0e6a52-2c55-4c1d-8a43-2f3f7a9e1c11';
const LOOP_ID = '2d1c9a77-5b3e-4f0a-8c6d-1e2f3a4b5c6d';
const RUN_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const LOOP = {
    enabled: true,
    id: LOOP_ID,
    instruction: 'Summarize new issues.',
    name: 'Morning triage',
    nextRunAt: '2026-11-24T09:00:00.000Z',
    schedule: { type: 'cron', expression: '0 9 * * *', timezone: 'UTC' },
    scheduleType: 'cron',
    trigger: { kind: 'schedule' },
};
const RUN = {
    automationId: LOOP_ID,
    id: RUN_ID,
    status: 'succeeded',
    triggeredAt: '2026-11-23T09:00:00.000Z',
};
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};

describe('dexto loops', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let host: CloudHost;
    let calls: { name: string; arguments: unknown }[];
    let replies: unknown[];
    let rpcError: unknown;
    let stdoutIsTerminal: boolean;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-loops-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        rpcError = null;
        stdoutIsTerminal = false;
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
            scopes: ['cloud:read', 'automations:read'],
            savedAt: '2026-11-01T00:00:00.000Z',
            signedInAs: null,
            cloudProject: null,
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
                if (rpcError !== null)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: rpcError });
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
            commands: builtCloudCommands(dir, unusedSignIn),
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

    it('lists with the tool and prints its own response, nextCursor included, as JSON', async () => {
        const page = { automations: [LOOP], nextCursor: 'cursor-2' };
        replies = [page];
        expect(await runCloud(host, ['loops', 'list', '--json'])).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_automations_list', arguments: {} }]);
        expect(JSON.parse(stdout)).toEqual(page);
    });

    it.each([
        [['--agent', AGENT], { agentId: AGENT }],
        [['--account'], { scope: { type: 'account' } }],
        [['--account', '--agent', AGENT], { scope: { type: 'account', agentId: AGENT } }],
        [['--in-project', PROJECT], { scope: { type: 'project', chatProjectId: PROJECT } }],
        [
            ['--in-project', PROJECT, '--agent', AGENT],
            { scope: { type: 'project', chatProjectId: PROJECT, agentId: AGENT } },
        ],
        [['--enabled'], { enabled: true }],
        [['--paused'], { enabled: false }],
    ])('selects whose Loops to list: %j', async (flags, expected) => {
        replies = [{ automations: [], nextCursor: null }];
        expect(await runCloud(host, ['loops', 'list', ...flags, '--json'])).toBe(0);
        expect(calls).toEqual([{ name: 'dexto_automations_list', arguments: expected }]);
    });

    it('forwards the page size and the cursor from the previous page', async () => {
        replies = [{ automations: [LOOP], nextCursor: null }];
        expect(
            await runCloud(host, [
                'loops',
                'list',
                '--account',
                '--limit',
                '5',
                '--after',
                'cursor-2',
                '--json',
            ])
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_automations_list',
                arguments: { scope: { type: 'account' }, limit: 5, cursor: 'cursor-2' },
            },
        ]);
    });

    it('shows people a table and how to read the next page', async () => {
        stdoutIsTerminal = true;
        replies = [{ automations: [LOOP], nextCursor: 'cursor-2' }];
        expect(await runCloud(host, ['loops', 'list'])).toBe(0);
        expect(stdout).toContain('Morning triage');
        expect(stdout).toContain(LOOP_ID);
        expect(stderr).toContain('--after cursor-2');
    });

    it('refuses conflicting scope or state flags before any call', async () => {
        expect(
            await runCloud(host, ['loops', 'list', '--account', '--in-project', PROJECT, '--json'])
        ).toBe(2);
        expect(await runCloud(host, ['loops', 'list', '--enabled', '--paused', '--json'])).toBe(2);
        expect(calls).toEqual([]);
    });

    it('gets one Loop by id, and its recent runs with --history', async () => {
        replies = [{ automation: LOOP }, { automation: LOOP, executions: [RUN] }];
        expect(await runCloud(host, ['loops', 'get', LOOP_ID, '--json'])).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ automation: LOOP });
        stdout = '';
        expect(
            await runCloud(host, ['loops', 'get', LOOP_ID, '--history-limit', '50', '--json'])
        ).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ automation: LOOP, executions: [RUN] });
        expect(calls).toEqual([
            { name: 'dexto_automation_get', arguments: { automationId: LOOP_ID } },
            {
                name: 'dexto_automation_get',
                arguments: { automationId: LOOP_ID, includeHistory: true, historyLimit: 50 },
            },
        ]);
    });

    it('reads one run in full, continuing its text and payload from offsets', async () => {
        replies = [{ automation: LOOP, executions: [RUN] }];
        expect(
            await runCloud(host, [
                'loops',
                'get',
                LOOP_ID,
                '--execution',
                RUN_ID,
                '--text-offset',
                '4000',
                '--payload-offset',
                '100',
                '--json',
            ])
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_automation_get',
                arguments: {
                    automationId: LOOP_ID,
                    executionId: RUN_ID,
                    textOffset: 4000,
                    payloadOffset: 100,
                },
            },
        ]);
    });

    it('shows people the Loop and a table of its runs', async () => {
        stdoutIsTerminal = true;
        replies = [{ automation: LOOP, executions: [RUN] }];
        expect(await runCloud(host, ['loops', 'get', LOOP_ID, '--history'])).toBe(0);
        expect(stdout).toContain('Morning triage');
        expect(stdout).toContain(RUN_ID);
        expect(stdout).toContain('succeeded');
    });

    it('needs a Loop id', async () => {
        expect(await runCloud(host, ['loops', 'get', '--json'])).toBe(2);
        expect(calls).toEqual([]);
    });

    it('reports a Loop the server does not find as not_found', async () => {
        rpcError = {
            code: -32004,
            message: 'Automation not found.',
            data: { kind: 'not_found', retryable: false },
        };
        expect(await runCloud(host, ['loops', 'get', LOOP_ID, '--json'])).toBe(5);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'Automation not found.',
        });
    });

    it('reports a scope the server forbids as needs_permission', async () => {
        rpcError = {
            code: -32003,
            message: 'You cannot list that agent’s Loops.',
            data: { kind: 'forbidden', retryable: false },
        };
        expect(await runCloud(host, ['loops', 'list', '--agent', AGENT, '--json'])).toBe(3);
        expect(JSON.parse(stderr).error).toMatchObject({ code: 'needs_permission' });
    });

    it('asks a sign-in without automations:read to sign in again for it', async () => {
        rpcError = {
            code: -32003,
            message: 'Missing required scope: automations:read',
            data: { kind: 'forbidden', scope: 'automations:read', retryable: false },
        };
        expect(await runCloud(host, ['loops', 'list', '--json'])).toBe(3);
        const { error } = JSON.parse(stderr);
        expect(error.code).toBe('needs_permission');
        expect(error.fix).toMatch(/^dexto login .*--scope automations:read$/);
    });
});
