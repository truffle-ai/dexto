import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a key.');
};

const RUN_ID = '0b6f7a52-3a4e-4d7e-9a43-6f1f1c2b9d10';
const SESSION_ID = '4a0f8b8e-1f3c-4b59-8d2a-7f1e2c3d4b5a';

function span(overrides: Record<string, unknown> = {}) {
    return {
        attributes: {},
        duration_ms: 1500.5,
        ended_at: '2026-11-04T10:00:01.500Z',
        error_code: null,
        error_message: null,
        id: 'span-1',
        name: 'llm.stream',
        object: 'run_span',
        parent_span_id: null,
        run_attempt_id: null,
        run_id: RUN_ID,
        session_id: SESSION_ID,
        span_id: 'span-1',
        started_at: '2026-11-04T10:00:00.000Z',
        status: 'completed',
        trace_id: 'trace-1',
        ...overrides,
    };
}

describe('trace and span', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let urls: string[];
    let reply: (url: string) => Response;
    let host: CloudHost;
    let terminal: boolean;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-trace-')), 'accounts');
        stdout = '';
        stderr = '';
        urls = [];
        terminal = false;
        reply = () => Response.json({});
        const runtime: CloudRuntime = {
            color: false,
            environment: { DEXTO_API_KEY: 'dxt_key' },
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                urls.push(request.url);
                return reply(request.url);
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
            signInForScope: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('lists traces with the 1.x filters, sent by their wire names', async () => {
        const page = {
            data: [
                {
                    duration_ms: 4000,
                    error_count: 1,
                    event_count: 2,
                    first_span_started_at: '2026-11-04T10:00:00.000Z',
                    last_span_started_at: '2026-11-04T10:00:03.000Z',
                    object: 'run_trace_summary',
                    run_id: RUN_ID,
                    session_id: SESSION_ID,
                    span_count: 3,
                    span_names: ['llm.stream'],
                    status: 'failed',
                },
            ],
            has_more: false,
            next_after: null,
            object: 'list',
        };
        reply = () => Response.json(page);

        const code = await runCloud(host, [
            'trace',
            'list',
            '--period',
            '3h',
            '--status',
            'failed',
            '--session',
            SESSION_ID,
            '--limit',
            '5',
        ]);

        expect(code).toBe(0);
        const url = new URL(urls[0] ?? '');
        expect(url.pathname).toBe('/v1/traces');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            limit: '5',
            period: '3h',
            session_id: SESSION_ID,
            status: 'failed',
        });
        expect(JSON.parse(stdout)).toEqual(page);
    });

    it('shows a table at a terminal and says when the limit cut the list', async () => {
        terminal = true;
        reply = () =>
            Response.json({
                data: [
                    {
                        duration_ms: 4000,
                        error_count: 0,
                        event_count: 0,
                        first_span_started_at: '2026-11-04T10:00:00.000Z',
                        last_span_started_at: '2026-11-04T10:00:03.000Z',
                        object: 'run_trace_summary',
                        run_id: RUN_ID,
                        session_id: SESSION_ID,
                        span_count: 3,
                        span_names: ['llm.stream'],
                        status: 'completed',
                    },
                ],
                has_more: true,
                next_after: null,
                object: 'list',
            });

        expect(await runCloud(host, ['trace', 'list', '--limit', '1'])).toBe(0);

        expect(stdout).toContain('RUN');
        expect(stdout).toContain(RUN_ID);
        expect(stdout).toContain('4000ms');
        expect(stderr).toContain(
            'More traces match: narrow --period or raise --limit (at most 100).'
        );
    });

    it('refuses an unknown status before calling', async () => {
        expect(await runCloud(host, ['trace', 'list', '--status', 'done'])).toBe(2);
        expect(urls).toHaveLength(0);
    });

    it("views a run's trace: its spans in start order, with failures", async () => {
        terminal = true;
        const trace = {
            events: [],
            has_more: true,
            object: 'run_trace',
            run_id: RUN_ID,
            spans: [
                span({
                    error_message: 'model timed out',
                    id: 'span-2',
                    name: 'tool.call',
                    span_id: 'span-2',
                    started_at: '2026-11-04T10:00:02.000Z',
                    status: 'failed',
                }),
                span(),
            ],
        };
        reply = () => Response.json(trace);

        expect(await runCloud(host, ['trace', 'view', RUN_ID])).toBe(0);

        expect(new URL(urls[0] ?? '').pathname).toBe(`/v1/traces/${RUN_ID}`);
        expect(stdout).toBe(
            [
                `Run trace ${RUN_ID}`,
                'Spans: 2  Events: 0',
                '',
                '2026-11-04T10:00:00.000Z  completed    1501ms  llm.stream',
                '2026-11-04T10:00:02.000Z  failed       1501ms  tool.call',
                '  error: model timed out',
                '',
            ].join('\n')
        );
        expect(stderr).toContain(
            `This trace stops at 2 spans. See the rest with dexto span list ${RUN_ID} --name or --status.`
        );
    });

    it("prints the trace's JSON when output is not a terminal", async () => {
        const trace = {
            events: [],
            has_more: false,
            object: 'run_trace',
            run_id: RUN_ID,
            spans: [span()],
        };
        reply = () => Response.json(trace);

        expect(await runCloud(host, ['trace', 'view', RUN_ID])).toBe(0);

        expect(JSON.parse(stdout)).toEqual(trace);
    });

    it("lists a run's spans with name, status, sort and limit", async () => {
        reply = () =>
            Response.json({ data: [span()], has_more: false, next_after: null, object: 'list' });

        const code = await runCloud(host, [
            'span',
            'list',
            RUN_ID,
            '--name',
            'llm.stream',
            '--status',
            'completed',
            '--sort',
            'duration',
            '--limit',
            '10',
        ]);

        expect(code).toBe(0);
        const url = new URL(urls[0] ?? '');
        expect(url.pathname).toBe(`/v1/traces/${RUN_ID}/spans`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            limit: '10',
            name: 'llm.stream',
            sort: 'duration',
            status: 'completed',
        });
    });

    it('says how to sign in for runs:read when the sign-in lacks it', async () => {
        reply = () =>
            Response.json(
                {
                    error: {
                        code: 'forbidden',
                        details: { scope: 'runs:read' },
                        message: 'This token lacks the runs:read scope.',
                    },
                },
                { status: 403 }
            );

        expect(await runCloud(host, ['trace', 'list', '--json'])).toBe(3);

        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'needs_permission',
            fix: expect.stringContaining('--scope runs:read'),
        });
    });

    it('fails with not_found for an unknown run', async () => {
        reply = () =>
            Response.json(
                { error: { code: 'not_found', message: 'Run not found.' } },
                { status: 404 }
            );

        expect(await runCloud(host, ['trace', 'view', RUN_ID, '--json'])).toBe(5);

        expect(JSON.parse(stderr).error).toMatchObject({ code: 'not_found' });
    });
});
