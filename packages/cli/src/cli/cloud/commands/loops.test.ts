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
/** The Loop tools that change a Loop, as the Dexto MCP lists them, each at its own level. */
const listedTools = (createLevel = 'work') =>
    [
        ['dexto_automation_create', 'Create Dexto automation', createLevel],
        ['dexto_automation_update', 'Update Dexto automation', 'work'],
        ['dexto_automation_trigger', 'Trigger Dexto automation', 'work'],
        ['dexto_automation_delete', 'Delete Dexto automation', 'act'],
    ].map(([name, title, level]) => ({
        _meta: { 'dexto/app': 'automations', 'dexto/level': level },
        inputSchema: {
            type: 'object',
            properties: { automationId: { type: 'string' } },
            required: ['automationId'],
            additionalProperties: false,
        },
        name,
        title,
    }));
async function signInWith(dir: string, scopes: string[]): Promise<void> {
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
    let answer: string | null;
    let prompts: string[];
    let tools: ReturnType<typeof listedTools>;
    let stdin: string;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-loops-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        rpcError = null;
        stdoutIsTerminal = false;
        answer = null;
        prompts = [];
        tools = listedTools();
        stdin = '';
        await signInWith(dir, ['cloud:read', 'automations:read', 'automations:write']);
        const runtime: CloudRuntime = {
            color: false,
            environment: {},
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url !== MCP)
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                const message = await request.json();
                if (message.method === 'tools/list')
                    return Response.json({
                        jsonrpc: '2.0',
                        id: message.id,
                        result: { tools },
                    });
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
            get prompt() {
                return answer === null
                    ? null
                    : async (question: string) => {
                          prompts.push(question);
                          return answer ?? '';
                      };
            },
            readStdin: async () => stdin,
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

    describe('run', () => {
        const TRIGGERED = { execution: { ...RUN, status: 'running' }, turn: { id: 'turn-1' } };

        it('runs the Loop by id without asking and prints the run it started as JSON', async () => {
            replies = [TRIGGERED];
            expect(await runCloud(host, ['loops', 'run', LOOP_ID, '--json'])).toBe(0);
            expect(calls).toEqual([
                { name: 'dexto_automation_trigger', arguments: { automationId: LOOP_ID } },
            ]);
            expect(JSON.parse(stdout)).toEqual(TRIGGERED);
        });

        it('tells people which run started', async () => {
            stdoutIsTerminal = true;
            replies = [TRIGGERED];
            expect(await runCloud(host, ['loops', 'run', LOOP_ID])).toBe(0);
            expect(stdout).toContain(`started run ${RUN_ID} (running)`);
        });

        it('reports a Loop the caller may not change as needs_permission', async () => {
            rpcError = {
                code: -32003,
                message: 'You cannot change that Loop.',
                data: { kind: 'forbidden', retryable: false },
            };
            expect(await runCloud(host, ['loops', 'run', LOOP_ID, '--json'])).toBe(3);
            expect(JSON.parse(stderr).error).toMatchObject({
                code: 'needs_permission',
                message: 'You cannot change that Loop.',
            });
        });

        it('reports a Loop the server does not find as not_found', async () => {
            rpcError = {
                code: -32004,
                message: 'Automation not found.',
                data: { kind: 'not_found', retryable: false },
            };
            expect(await runCloud(host, ['loops', 'run', LOOP_ID, '--json'])).toBe(5);
            expect(JSON.parse(stderr).error).toMatchObject({ code: 'not_found' });
        });

        it('needs a Loop id', async () => {
            expect(await runCloud(host, ['loops', 'run', '--json'])).toBe(2);
            expect(calls).toEqual([]);
        });
    });

    describe('delete', () => {
        it('deletes the Loop by id with --yes and prints the result as JSON', async () => {
            replies = [{ ok: true }];
            expect(await runCloud(host, ['loops', 'delete', LOOP_ID, '--yes', '--json'])).toBe(0);
            expect(calls).toEqual([
                { name: 'dexto_automation_delete', arguments: { automationId: LOOP_ID } },
            ]);
            expect(JSON.parse(stdout)).toEqual({ ok: true });
        });

        it('refuses without --yes when nobody can be asked, and sends no delete', async () => {
            expect(await runCloud(host, ['loops', 'delete', LOOP_ID, '--json'])).not.toBe(0);
            const { error } = JSON.parse(stderr);
            expect(error.code).toBe('needs_confirmation');
            expect(error.fix).toBe(`dexto loops delete ${LOOP_ID} --json --yes`);
            expect(calls).toEqual([]);
        });

        it('asks at a terminal, and deletes only on yes', async () => {
            answer = 'n';
            expect(await runCloud(host, ['loops', 'delete', LOOP_ID])).not.toBe(0);
            expect(prompts).toEqual([
                `"Delete Loop ${LOOP_ID}" asks before it runs (level act). Go ahead? [y/N] `,
            ]);
            expect(calls).toEqual([]);

            answer = 'y';
            stdoutIsTerminal = true;
            replies = [{ ok: true }];
            expect(await runCloud(host, ['loops', 'delete', LOOP_ID])).toBe(0);
            expect(calls).toEqual([
                { name: 'dexto_automation_delete', arguments: { automationId: LOOP_ID } },
            ]);
            expect(stdout).toContain(`Deleted Loop ${LOOP_ID}.`);
        });

        it('reports a Loop the caller may not delete as needs_permission', async () => {
            rpcError = {
                code: -32003,
                message: 'You cannot change that Loop.',
                data: { kind: 'forbidden', retryable: false },
            };
            expect(await runCloud(host, ['loops', 'delete', LOOP_ID, '--yes', '--json'])).toBe(3);
            expect(JSON.parse(stderr).error).toMatchObject({ code: 'needs_permission' });
        });
    });

    describe('create', () => {
        const SCHEDULED = {
            name: 'Morning triage',
            instruction: 'Summarize new issues.',
            schedule: { type: 'cron', expression: '0 9 * * 1-5', timezone: 'Europe/Berlin' },
            scope: { type: 'project', chatProjectId: PROJECT },
            agentId: AGENT,
            execution: { kind: 'worker', continuity: 'fresh' },
            reporting: { kind: 'slack', installationId: 'inst-1', channelId: 'C0123' },
            enabled: true,
            runNow: false,
        };
        const EVENT = {
            name: 'Triage new issues',
            instruction: 'Label the new issue.',
            scope: { type: 'account' },
            trigger: {
                kind: 'github',
                event: 'github.issue.opened',
                repository: 'acme/api',
            },
            reporting: { kind: 'assistant' },
        };

        it('creates a scheduled Loop from --data, forwarding every field, and prints the tool result', async () => {
            replies = [{ automation: LOOP }];
            expect(
                await runCloud(host, [
                    'loops',
                    'create',
                    '--data',
                    JSON.stringify(SCHEDULED),
                    '--json',
                ])
            ).toBe(0);
            expect(calls).toEqual([{ name: 'dexto_automation_create', arguments: SCHEDULED }]);
            expect(JSON.parse(stdout)).toEqual({ automation: LOOP });
        });

        it('creates an event-triggered Loop from a file on stdin', async () => {
            stdin = JSON.stringify(EVENT);
            const created = { automation: { ...LOOP, scheduleType: 'event', nextRunAt: null } };
            replies = [created];
            expect(await runCloud(host, ['loops', 'create', '--file', '-', '--json'])).toBe(0);
            expect(calls).toEqual([{ name: 'dexto_automation_create', arguments: EVENT }]);
            expect(JSON.parse(stdout)).toEqual(created);
        });

        it('tells people which Loop it created', async () => {
            stdoutIsTerminal = true;
            replies = [{ automation: LOOP }];
            expect(
                await runCloud(host, ['loops', 'create', '--data', JSON.stringify(SCHEDULED)])
            ).toBe(0);
            expect(stdout).toContain(`Created Loop ${LOOP_ID} (Morning triage).`);
        });

        it.each([[[]], [['--data', '[1]']], [['--data', '{nope']]])(
            'needs a JSON object for the Loop, before any call: %j',
            async (flags) => {
                expect(await runCloud(host, ['loops', 'create', ...flags, '--json'])).toBe(2);
                expect(calls).toEqual([]);
            }
        );

        it('refuses without --yes when the tool asks first and nobody can be asked', async () => {
            tools = listedTools('approve');
            const data = JSON.stringify(EVENT);
            expect(await runCloud(host, ['loops', 'create', '--data', data, '--json'])).not.toBe(0);
            const { error } = JSON.parse(stderr);
            expect(error.code).toBe('needs_confirmation');
            expect(error.fix).toBe(`dexto loops create --data '${data}' --json --yes`);
            expect(calls).toEqual([]);

            stderr = '';
            replies = [{ automation: LOOP }];
            expect(
                await runCloud(host, ['loops', 'create', '--data', data, '--yes', '--json'])
            ).toBe(0);
            expect(calls).toEqual([{ name: 'dexto_automation_create', arguments: EVENT }]);
        });

        it("returns the server's own refusals: a scope it forbids, invalid input", async () => {
            const data = JSON.stringify(SCHEDULED);
            rpcError = {
                code: -32003,
                message: 'You cannot create Loops in that Project.',
                data: { kind: 'forbidden', retryable: false },
            };
            expect(await runCloud(host, ['loops', 'create', '--data', data, '--json'])).toBe(3);
            expect(JSON.parse(stderr).error).toMatchObject({
                code: 'needs_permission',
                message: 'You cannot create Loops in that Project.',
            });

            stderr = '';
            rpcError = {
                code: -32602,
                message: 'Invalid Dexto automation create input. schedule: Required',
                data: { kind: 'invalid_arguments', retryable: false },
            };
            expect(await runCloud(host, ['loops', 'create', '--data', data, '--json'])).toBe(2);
            expect(JSON.parse(stderr).error).toMatchObject({
                code: 'invalid_input',
                message: 'Invalid Dexto automation create input. schedule: Required',
            });
        });
    });

    describe('update', () => {
        it('replaces what starts a Loop with an event trigger, forwarding every field', async () => {
            const change = {
                trigger: {
                    kind: 'slack',
                    event: 'slack.message.created',
                    teamId: 'T0123',
                    channelId: 'C0123',
                },
                instruction: 'Answer the question.',
                reporting: { kind: 'slack', installationId: 'inst-1', channelId: 'C0123' },
                execution: { kind: 'worker', continuity: 'reuse' },
            };
            replies = [{ automation: LOOP }];
            expect(
                await runCloud(host, [
                    'loops',
                    'update',
                    LOOP_ID,
                    '--data',
                    JSON.stringify(change),
                    '--json',
                ])
            ).toBe(0);
            expect(calls).toEqual([
                {
                    name: 'dexto_automation_update',
                    arguments: { automationId: LOOP_ID, ...change },
                },
            ]);
            expect(JSON.parse(stdout)).toEqual({ automation: LOOP });
        });

        it('puts a Loop back on a schedule and pauses it, and tells people', async () => {
            stdoutIsTerminal = true;
            const change = {
                trigger: { kind: 'schedule' },
                schedule: { type: 'cron', expression: '0 9 * * *', timezone: 'UTC' },
                enabled: false,
                scope: { type: 'account' },
            };
            replies = [{ automation: { ...LOOP, enabled: false } }];
            expect(
                await runCloud(host, ['loops', 'update', LOOP_ID, '--data', JSON.stringify(change)])
            ).toBe(0);
            expect(calls).toEqual([
                {
                    name: 'dexto_automation_update',
                    arguments: { automationId: LOOP_ID, ...change },
                },
            ]);
            expect(stdout).toContain(`Updated Loop ${LOOP_ID} (Morning triage).`);
        });

        it.each([
            [[LOOP_ID]],
            [['--data', '{"enabled":false}']],
            [[LOOP_ID, '--data', '"paused"']],
            [[LOOP_ID, '--data', JSON.stringify({ automationId: RUN_ID, enabled: false })]],
        ])(
            'needs a Loop id and a JSON object of changes for it, before any call: %j',
            async (args) => {
                expect(await runCloud(host, ['loops', 'update', ...args, '--json'])).toBe(2);
                expect(calls).toEqual([]);
            }
        );

        it('reports a Loop the server does not find as not_found', async () => {
            rpcError = {
                code: -32004,
                message: 'Automation not found.',
                data: { kind: 'not_found', retryable: false },
            };
            expect(
                await runCloud(host, [
                    'loops',
                    'update',
                    LOOP_ID,
                    '--data',
                    '{"enabled":false}',
                    '--json',
                ])
            ).toBe(5);
            expect(JSON.parse(stderr).error).toMatchObject({ code: 'not_found' });
        });
    });

    it.each([
        [['create', '--data', '{"name":"n","instruction":"i"}']],
        [['update', LOOP_ID, '--data', '{"enabled":false}']],
    ])(
        'asks a sign-in without automations:write to sign in again before it changes a Loop: %j',
        async (args) => {
            await signInWith(dir, ['cloud:read', 'automations:read']);
            expect(await runCloud(host, ['loops', ...args, '--yes', '--json'])).toBe(3);
            const { error } = JSON.parse(stderr);
            expect(error.code).toBe('needs_permission');
            expect(error.fix).toMatch(/^dexto login .*--scope automations:write$/);
            expect(calls).toEqual([]);
        }
    );

    it.each([['run'], ['delete']])(
        'asks a sign-in without automations:write to sign in again before %s calls anything',
        async (verb) => {
            await signInWith(dir, ['cloud:read', 'automations:read']);
            expect(await runCloud(host, ['loops', verb, LOOP_ID, '--yes', '--json'])).toBe(3);
            const { error } = JSON.parse(stderr);
            expect(error.code).toBe('needs_permission');
            expect(error.fix).toMatch(/^dexto login .*--scope automations:write$/);
            expect(calls).toEqual([]);
        }
    );
});
