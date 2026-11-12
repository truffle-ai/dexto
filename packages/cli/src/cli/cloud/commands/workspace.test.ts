import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';

const TOOLS = [
    {
        name: 'dexto_search',
        title: 'Search your workspace',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        _meta: { 'dexto/app': 'search', 'dexto/level': 'read' },
    },
    {
        name: 'dexto_site_publish',
        title: 'Publish a link',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' }, confirm: { type: 'boolean' } },
        },
        _meta: { 'dexto/app': 'sites', 'dexto/level': 'act' },
    },
    {
        name: 'dexto_chat_get',
        title: 'Get a chat',
        inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } } },
        _meta: { 'dexto/app': 'chat', 'dexto/level': 'read' },
    },
    {
        name: 'dexto_chat_list',
        title: 'List chats',
        inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
        _meta: { 'dexto/app': 'chat', 'dexto/level': 'read' },
    },
    {
        name: 'dexto_email_send',
        title: 'Send an email',
        inputSchema: {
            type: 'object',
            properties: { to: { type: 'string' }, confirm: { type: 'boolean' } },
        },
        _meta: { 'dexto/app': 'email', 'dexto/level': 'act' },
    },
];

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a key or a saved login.');
};

describe('dexto workspace', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { method: string; params: { name?: string; arguments?: unknown } }[];
    let authorization: (string | null)[];
    let environment: Record<string, string>;
    let uploads: { url: string; method: string; bytes: Uint8Array }[];
    let host: CloudHost;
    let publishResponse: unknown;
    let publishProject: string | null;
    let publishStatus: number;
    let chatResponse: unknown;
    let computersResponse: unknown;
    let profilesResponse: unknown;
    let followResponses: unknown[];
    let chatInspection: unknown;
    let appScopes: Record<string, Record<string, string[]>>;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-ws-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        authorization = [];
        environment = {};
        uploads = [];
        publishResponse = undefined;
        chatResponse = {
            session: {
                id: 'chat-1',
                title: 'A task',
                url: 'https://app.dexto.ai/chat/chat-1',
                status: 'running',
            },
        };
        computersResponse = {
            computers: [
                {
                    id: 'computer-1',
                    name: 'Desk',
                    platform: 'macos',
                    presence: 'online',
                    compatible: true,
                    feature: { enabled: true, variant: 'standard' },
                },
            ],
        };
        followResponses = [];
        chatInspection = {};
        appScopes = {};
        profilesResponse = { profiles: [{ id: 'profile-1', name: 'Work', available: true }] };
        publishStatus = 200;
        publishProject = null;
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
            scopes: ['cloud:read', 'cloud:write', 'email:send', 'sites:write'],
            savedAt: '2026-11-01T00:00:00.000Z',
            signedInAs: null,
            cloudProject: { id: 'project-1', name: 'Main' },
        });
        const runtime: CloudRuntime = {
            color: false,
            environment,
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url.endsWith('/.well-known/oauth-protected-resource/mcp'))
                    return Response.json({ resource: MCP, dexto_app_scopes: appScopes });
                if (request.url.startsWith('https://upload.example/')) {
                    uploads.push({
                        url: request.url,
                        method: request.method,
                        bytes: new Uint8Array(await request.arrayBuffer()),
                    });
                    return new Response(null, { status: 200 });
                }
                if (request.url === 'https://api.dexto.ai/v1/sites/publish') {
                    const body: unknown = await request.json();
                    publishProject = request.headers.get('dexto-cloud-project');
                    calls.push({
                        method: 'POST',
                        params: { name: 'POST /v1/sites/publish', arguments: body },
                    });
                    const visibility =
                        typeof body === 'object' && body !== null && 'visibility' in body
                            ? body.visibility
                            : 'unlisted';
                    return Response.json(
                        publishResponse ?? {
                            created: true,
                            files: 2,
                            homepage: 'index.html',
                            site: { id: 'site-1', slug: 'hello', title: 'Hello' },
                            url: 'https://hello.dexto.page',
                            visibility,
                        },
                        { status: publishStatus }
                    );
                }
                if (request.url !== MCP) return Response.json({}, { status: 404 });
                authorization.push(request.headers.get('authorization'));
                const message = JSON.parse(await request.text());
                calls.push({ method: message.method, params: message.params });
                const tool = message.params?.name;
                const structured =
                    tool === 'dexto_upload_prepare'
                        ? {
                              url: 'https://upload.example/u1',
                              method: 'PUT',
                              headers: {},
                              path: 'uploads/u1.zip',
                          }
                        : tool === 'dexto_chat_follow' || tool === 'dexto_chat_wait'
                          ? followResponses.shift()
                          : tool === 'dexto_chat_get' || tool === 'dexto_chat_list'
                            ? chatInspection
                            : tool === 'dexto_chat_start'
                              ? chatResponse
                              : tool === 'dexto_chat_computers_list'
                                ? computersResponse
                                : tool === 'dexto_chat_browser_profiles_list'
                                  ? profilesResponse
                                  : { status: 'sent' };
                const result =
                    message.method === 'tools/list'
                        ? { tools: TOOLS }
                        : {
                              content: [{ type: 'text', text: 'ok' }],
                              structuredContent: structured,
                          };
                return Response.json({ jsonrpc: '2.0', id: message.id, result });
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
                    environment,
                    overrides,
                    refresh: async (login: dextoAccounts.OAuthLogin) => login,
                }),
            signInForScope: async () => false,
        };
    });

    it('reports missing permissions for a hidden workspace tool', async () => {
        appScopes = { projects: { dexto_project_create: ['projects:write'] } };
        expect(
            await runCloud(host, ['workspace', 'describe', 'dexto_project_create', '--json'])
        ).toBe(3);
        expect(stderr).toContain('needs_permission');
        expect(stderr).toContain('projects:write');
    });

    it('shows a concise workspace app help list and leaves schemas to operation help', async () => {
        expect(await runCloud(host, ['workspace', 'chat', '--help', '--json'])).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.data.map((operation: { name: string }) => operation.name)).toContain('list');
        expect(stdout).not.toContain('inputSchema');
    });

    const page = (outcome = 'done', cursor = 'chat-1:1') => ({
        outcome,
        running: outcome === 'running',
        cursor,
        hasMore: false,
        session: { id: 'chat-1' },
        events: [{ id: cursor }],
        answer: 'Finished answer',
        artifacts: [{ name: 'report.txt' }],
        usage: { totalChargeUsd: 0.01 },
    });

    it('start --wait starts once and prints events and a final NDJSON answer', async () => {
        followResponses = [page('running'), page('done', 'chat-1:2')];
        expect(await runCloud(host, ['chat', 'start', 'Hello', '--wait', '--json'])).toBe(0);
        const lines = stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines.map((line) => line.type)).toEqual(['event', 'event', 'final']);
        expect(lines.at(-1)).toMatchObject({
            answer: 'Finished answer',
            artifacts: [{ name: 'report.txt' }],
            usage: { totalChargeUsd: 0.01 },
        });
        expect(calls.filter((call) => call.params.name === 'dexto_chat_start')).toHaveLength(1);
        expect(
            calls.find((call) => call.params.name === 'dexto_chat_follow')?.params.arguments
        ).toMatchObject({ cursor: 'chat-1:1' });
    });
    it('ends an unbounded follow with a resumable needs_input final record', async () => {
        followResponses = [
            {
                ...page('running'),
                outcome: 'needs_input',
                session: { id: 'chat-1', status: 'waiting_approval' },
                usage: null,
                nextAction: {
                    tool: 'dexto_chat_get',
                    arguments: { sessionId: 'chat-1' },
                    instruction: 'Resolve the pending approval in Dexto.',
                },
            },
        ];
        expect(await runCloud(host, ['chat', 'follow', 'chat-1', '--json'])).toBe(6);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
            type: 'final',
            outcome: 'needs_input',
            nextAction: { instruction: 'Resolve the pending approval in Dexto.' },
        });
    });
    it('follow resumes at a cursor and exits 6 after timeout without cancelling', async () => {
        followResponses = [page('running')];
        expect(
            await runCloud(host, [
                'chat',
                'follow',
                'chat-1',
                '--cursor',
                'chat-1:0',
                '--timeout',
                '0',
                '--json',
            ])
        ).toBe(6);
        expect(
            calls.find((call) => call.params.name === 'dexto_chat_follow')?.params.arguments
        ).toMatchObject({ cursor: 'chat-1:0', waitSeconds: 0 });
        expect(calls.some((call) => call.params.name === 'dexto_chat_cancel')).toBe(false);
    });
    it.each(['follow', 'start'])(
        'Ctrl-C during %s ends NDJSON with a resumable final record',
        async (command) => {
            followResponses = [page('running')];
            const controller = new AbortController();
            const interruptedHost: CloudHost = {
                ...host,
                runtime: {
                    ...host.runtime,
                    signal: controller.signal,
                    fetch: async (input, init) => {
                        const request = new globalThis.Request(input, init);
                        const name = JSON.parse(await request.clone().text()).params?.name;
                        const response = await host.runtime.fetch(request);
                        if (name === 'dexto_chat_wait' || name === 'dexto_chat_follow')
                            controller.abort();
                        return response;
                    },
                },
            };
            const args =
                command === 'start'
                    ? ['chat', 'start', 'Hello', '--wait', '--json']
                    : ['chat', 'follow', 'chat-1', '--json'];
            expect(await runCloud(interruptedHost, args)).toBe(130);
            const lines = stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(lines.at(-1)).toMatchObject({
                type: 'final',
                interrupted: true,
                cursor: 'chat-1:1',
                nextAction: {
                    tool: 'dexto_chat_follow',
                    arguments: { sessionId: 'chat-1', cursor: 'chat-1:1' },
                },
            });
            expect(calls.some((call) => call.params.name === 'dexto_chat_cancel')).toBe(false);
        }
    );

    it('a wait permission failure never grants and replays a billable start', async () => {
        let grants = 0;
        const waitingHost: CloudHost = {
            ...host,
            signInForScope: async () => {
                grants++;
                return true;
            },
            runtime: {
                ...host.runtime,
                stdoutIsTerminal: true,
                prompt: async () => 'yes',
                fetch: async (input, init) => {
                    const request = new globalThis.Request(input, init);
                    const message = JSON.parse(await request.clone().text());
                    if (message.params?.name === 'dexto_chat_wait')
                        return Response.json({
                            jsonrpc: '2.0',
                            id: message.id,
                            error: {
                                code: -32602,
                                message: 'Missing required scope: sessions:read',
                                data: { kind: 'forbidden', scope: 'sessions:read' },
                            },
                        });
                    return host.runtime.fetch(request);
                },
            },
        };
        expect(await runCloud(waitingHost, ['chat', 'start', 'Hello', '--wait'])).toBe(3);
        expect(calls.filter((call) => call.params.name === 'dexto_chat_start')).toHaveLength(1);
        expect(grants).toBe(0);
        expect(stdout).toContain('dexto chat follow');
    });
    it('a follow transport error ends NDJSON with the last cursor', async () => {
        followResponses = [page('running')];
        let reads = 0;
        const failingHost: CloudHost = {
            ...host,
            runtime: {
                ...host.runtime,
                fetch: async (input, init) => {
                    const request = new globalThis.Request(input, init);
                    const message = JSON.parse(await request.clone().text());
                    if (message.params?.name === 'dexto_chat_follow' && reads++ > 0)
                        throw new Error('Connection closed');
                    return host.runtime.fetch(request);
                },
            },
        };
        expect(await runCloud(failingHost, ['chat', 'follow', 'chat-1', '--json'])).toBe(1);
        const lines = stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines.at(-1)).toMatchObject({
            type: 'final',
            outcome: 'error',
            cursor: 'chat-1:1',
            nextAction: { tool: 'dexto_chat_follow', arguments: { cursor: 'chat-1:1' } },
        });
    });

    it('retries a rate-limited wait read after Retry-After without repeating start', async () => {
        followResponses = [page('done')];
        const delays: number[] = [];
        let reads = 0;
        const retryHost: CloudHost = {
            ...host,
            runtime: {
                ...host.runtime,
                sleep: async (ms) => {
                    delays.push(ms);
                },
                fetch: async (input, init) => {
                    const request = new globalThis.Request(input, init);
                    const message = JSON.parse(await request.clone().text());
                    if (message.params?.name === 'dexto_chat_wait' && reads++ === 0)
                        return new Response(null, { status: 429, headers: { 'Retry-After': '2' } });
                    return host.runtime.fetch(request);
                },
            },
        };
        expect(await runCloud(retryHost, ['chat', 'start', 'Hello', '--wait', '--json'])).toBe(0);
        expect(delays).toEqual([2000]);
        expect(reads).toBe(2);
        expect(calls.filter((call) => call.params.name === 'dexto_chat_start')).toHaveLength(1);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
            type: 'final',
            outcome: 'done',
        });
    });

    it.each([503, 'network'])(
        'retries a transient %s read and preserves its cursor',
        async (status) => {
            followResponses = [page('done')];
            let reads = 0;
            const retryHost: CloudHost = {
                ...host,
                runtime: {
                    ...host.runtime,
                    fetch: async (input, init) => {
                        const request = new globalThis.Request(input, init);
                        const message = JSON.parse(await request.clone().text());
                        if (message.params?.name === 'dexto_chat_follow' && reads++ === 0) {
                            if (typeof status === 'string') throw new TypeError('fetch failed');
                            return new Response(null, { status });
                        }
                        return host.runtime.fetch(request);
                    },
                },
            };
            expect(
                await runCloud(retryHost, [
                    'chat',
                    'follow',
                    'chat-1',
                    '--cursor',
                    'chat-1:0',
                    '--json',
                ])
            ).toBe(0);
            expect(reads).toBe(2);
            expect(
                calls.find((call) => call.params.name === 'dexto_chat_follow')?.params.arguments
            ).toMatchObject({ cursor: 'chat-1:0' });
        }
    );

    it('preserves the error when Retry-After exceeds the deadline', async () => {
        let reads = 0;
        const retryHost: CloudHost = {
            ...host,
            runtime: {
                ...host.runtime,
                sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
                fetch: async (input, init) => {
                    const request = new globalThis.Request(input, init);
                    const message = JSON.parse(await request.clone().text());
                    if (message.params?.name === 'dexto_chat_follow') {
                        reads++;
                        return new Response(null, { status: 503, headers: { 'Retry-After': '2' } });
                    }
                    return host.runtime.fetch(request);
                },
            },
        };
        expect(
            await runCloud(retryHost, [
                'chat',
                'follow',
                'chat-1',
                '--cursor',
                'chat-1:0',
                '--timeout',
                '0.05',
                '--json',
            ])
        ).toBe(1);
        expect(reads).toBe(1);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
            type: 'final',
            cursor: 'chat-1:0',
            outcome: 'error',
        });
    });

    it('does not retry an unrelated TypeError', async () => {
        let reads = 0;
        const failingHost: CloudHost = {
            ...host,
            runtime: {
                ...host.runtime,
                fetch: async (input, init) => {
                    const request = new globalThis.Request(input, init);
                    const message = JSON.parse(await request.clone().text());
                    if (message.params?.name === 'dexto_chat_follow') {
                        reads++;
                        throw new TypeError('unexpected value');
                    }
                    return host.runtime.fetch(request);
                },
            },
        };
        expect(await runCloud(failingHost, ['chat', 'follow', 'chat-1', '--json'])).toBe(1);
        expect(reads).toBe(1);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
            outcome: 'error',
            error: { message: 'unexpected value' },
        });
    });

    it.each(['follow', 'start'])(
        'retries a stalled %s read when the user deadline remains',
        async (command) => {
            vi.useFakeTimers();
            try {
                followResponses = [page('done')];
                let seenRead: () => void = () => {
                    throw new Error('Read observer is not ready.');
                };
                const firstRead = new Promise<void>((resolve) => {
                    seenRead = resolve;
                });
                let reads = 0;
                const stalledHost: CloudHost = {
                    ...host,
                    runtime: {
                        ...host.runtime,
                        fetch: async (input, init) => {
                            const request = new globalThis.Request(input, init);
                            const message = JSON.parse(await request.clone().text());
                            if (
                                (message.params?.name === 'dexto_chat_wait' ||
                                    message.params?.name === 'dexto_chat_follow') &&
                                reads++ === 0
                            ) {
                                seenRead();
                                return new Promise((_resolve, reject) =>
                                    request.signal.addEventListener(
                                        'abort',
                                        () => reject(request.signal.reason),
                                        { once: true }
                                    )
                                );
                            }
                            return host.runtime.fetch(request);
                        },
                    },
                };
                const args =
                    command === 'start'
                        ? ['chat', 'start', 'Hello', '--wait']
                        : ['chat', 'follow', 'chat-1'];
                const completion = runCloud(stalledHost, [...args, '--timeout', '60', '--json']);
                await firstRead;
                await vi.advanceTimersByTimeAsync(26_500);
                expect(await completion).toBe(0);
                expect(reads).toBe(2);
                expect(
                    calls.filter((call) => call.params.name === 'dexto_chat_start')
                ).toHaveLength(command === 'start' ? 1 : 0);
                expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
                    type: 'final',
                    outcome: 'done',
                });
            } finally {
                vi.useRealTimers();
            }
        }
    );

    it('ends a refused start --wait with a final NDJSON record', async () => {
        chatResponse = {
            outcome: 'profile_busy',
            nextAction: { tool: 'dexto_chat_browser_profiles_list', arguments: {} },
            type: 'untrusted',
        };
        expect(await runCloud(host, ['chat', 'start', 'Hello', '--wait', '--json'])).toBe(6);
        expect(
            stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line))
        ).toEqual([expect.objectContaining({ type: 'final', outcome: 'profile_busy' })]);
    });

    it('prints readable events and an input hint in text mode', async () => {
        followResponses = [
            {
                ...page('running'),
                outcome: 'needs_input',
                events: [{ type: 'run.started', sequence: 1, payload: {} }],
                nextAction: { instruction: 'Resolve the pending approval in Dexto.' },
            },
        ];
        expect(await runCloud(host, ['chat', 'follow', 'chat-1', '--table'])).toBe(6);
        expect(stdout).toContain('run.started');
        expect(stdout).toContain('Resolve the pending approval');
        expect(stdout).not.toContain('{"type":"run.started"');
    });

    it('shows recorded billing routes and preserves them in JSON', async () => {
        const billingRoutes = [
            {
                provider: 'openai',
                billingMode: 'byok',
                authMethodId: 'chatgpt_login',
                billedPlans: ['chatgpt_subscription'],
                creditsUsd: 0,
                allowanceUsd: 0,
                callsWithoutLedger: 1,
            },
        ];
        followResponses = [{ ...page('done'), usage: { runId: 'run-1', billingRoutes } }];
        expect(await runCloud(host, ['chat', 'follow', 'chat-1', '--table'])).toBe(0);
        expect(stdout).toContain('Recorded billing routes (usage may be incomplete):');
        expect(stdout).toContain('chatgpt_subscription');
        stdout = '';
        followResponses = [{ ...page('done'), usage: { runId: 'run-1', billingRoutes } }];
        expect(await runCloud(host, ['chat', 'follow', 'chat-1', '--json'])).toBe(0);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
            usage: { runId: 'run-1', billingRoutes },
        });
    });

    it('does not infer a billing route when no facts are recorded', async () => {
        followResponses = [{ ...page('done'), usage: { runId: 'run-1', billingRoutes: [] } }];
        expect(await runCloud(host, ['chat', 'follow', 'chat-1', '--table'])).toBe(0);
        expect(stdout).toContain(
            'Recorded billing routes (usage may be incomplete): unknown (no recorded routes)'
        );
    });

    it('sets the final record type after server fields', async () => {
        followResponses = [{ ...page('done'), type: 'untrusted' }];
        expect(await runCloud(host, ['chat', 'follow', 'chat-1', '--json'])).toBe(0);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}').type).toBe('final');
    });

    it.each(['follow', 'start'])(
        'a stalled %s read respects --timeout and remains resumable',
        async (command) => {
            let readSignal: AbortSignal | null = null;
            const stalledHost: CloudHost = {
                ...host,
                runtime: {
                    ...host.runtime,
                    fetch: async (input, init) => {
                        const request = new globalThis.Request(input, init);
                        const message = JSON.parse(await request.clone().text());
                        if (
                            message.params?.name === 'dexto_chat_wait' ||
                            message.params?.name === 'dexto_chat_follow'
                        ) {
                            readSignal = request.signal;
                            request.signal.throwIfAborted();
                            return new Promise((_resolve, reject) =>
                                request.signal.addEventListener(
                                    'abort',
                                    () => reject(request.signal.reason),
                                    { once: true }
                                )
                            );
                        }
                        return host.runtime.fetch(request);
                    },
                },
            };
            const args =
                command === 'start'
                    ? ['chat', 'start', 'Hello', '--wait', '--timeout', '0', '--json']
                    : [
                          'chat',
                          'follow',
                          'chat-1',
                          '--cursor',
                          'chat-1:0',
                          '--timeout',
                          '0',
                          '--json',
                      ];
            expect(await runCloud(stalledHost, args)).toBe(6);
            expect(readSignal).toMatchObject({ aborted: true });
            const lines = stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toMatchObject({
                type: 'final',
                outcome: 'running',
                nextAction: { tool: 'dexto_chat_follow', arguments: { sessionId: 'chat-1' } },
                cursor: command === 'follow' ? 'chat-1:0' : null,
            });
            expect(calls.filter((call) => call.params.name === 'dexto_chat_start')).toHaveLength(
                command === 'start' ? 1 : 0
            );
            expect(calls.some((call) => call.params.name === 'dexto_chat_cancel')).toBe(false);
        }
    );

    it.each(['failed', 'cancelled'])('follow reports %s with a nonzero exit', async (outcome) => {
        followResponses = [page(outcome)];
        expect(await runCloud(host, ['chat', 'follow', 'chat-1', '--json'])).toBe(1);
        expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
            type: 'final',
            outcome,
        });
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('starts a chat with the selected computer and browser profile through MCP', async () => {
        expect(
            await runCloud(host, [
                'chat',
                'start',
                'Investigate the bug',
                '--computer',
                'computer-1',
                '--browser-profile',
                'profile-1',
                '--yes',
                '--model',
                'model-1',
                '--title',
                'Bug',
            ])
        ).toBe(0);
        expect(calls).toContainEqual({
            method: 'tools/call',
            params: {
                name: 'dexto_chat_start',
                arguments: {
                    message: 'Investigate the bug',
                    computerId: 'computer-1',
                    browserProfileId: 'profile-1',
                    model: 'model-1',
                    title: 'Bug',
                    confirm: true,
                },
            },
        });
        expect(JSON.parse(stdout)).toEqual(chatResponse);
    });

    it.each(['truffle-ai/dexto', ' https://github.com/truffle-ai/dexto/ '])(
        'passes repository context %s unchanged to chat start',
        async (repository) => {
            expect(
                await runCloud(host, [
                    'chat',
                    'start',
                    'Investigate the bug',
                    '--repository',
                    repository,
                ])
            ).toBe(0);
            expect(calls).toContainEqual({
                method: 'tools/call',
                params: {
                    name: 'dexto_chat_start',
                    arguments: { message: 'Investigate the bug', repository },
                },
            });
        }
    );

    it('omits unset chat start choices', async () => {
        expect(await runCloud(host, ['chat', 'start', 'Hello'])).toBe(0);
        expect(calls).toContainEqual({
            method: 'tools/call',
            params: { name: 'dexto_chat_start', arguments: { message: 'Hello' } },
        });
    });

    it.each([
        ['computers', 'dexto_chat_computers_list'],
        ['browser-profiles', 'dexto_chat_browser_profiles_list'],
    ])('discovers chat %s through MCP', async (verb, tool) => {
        expect(await runCloud(host, ['chat', verb])).toBe(0);
        expect(calls).toContainEqual({
            method: 'tools/call',
            params: { name: tool, arguments: {} },
        });
    });

    it.each([
        {
            outcome: 'computer_not_found',
            nextAction: { tool: 'dexto_chat_computers_list', arguments: {} },
            code: 5,
            fix: 'dexto chat computers',
        },
        {
            outcome: 'computer_offline',
            nextAction: { tool: 'dexto_chat_computers_list', arguments: {} },
            code: 6,
            fix: 'dexto chat computers',
        },
        { outcome: 'computer_incompatible', nextAction: null, code: 1, fix: undefined },
        { outcome: 'feature_denied', nextAction: null, code: 3, fix: undefined },
        {
            outcome: 'profile_not_found',
            nextAction: { tool: 'dexto_chat_browser_profiles_list', arguments: {} },
            code: 5,
            fix: 'dexto chat browser-profiles',
        },
        {
            outcome: 'profile_busy',
            nextAction: { tool: 'dexto_chat_browser_profiles_list', arguments: {} },
            code: 6,
            fix: 'dexto chat browser-profiles',
        },
        {
            outcome: 'profile_unavailable',
            nextAction: { tool: 'dexto_chat_browser_profiles_list', arguments: {} },
            code: 1,
            fix: 'dexto chat browser-profiles',
        },
    ])(
        'returns a non-zero exit for $outcome while preserving its JSON outcome',
        async ({ outcome, nextAction, code, fix }) => {
            chatResponse = { outcome, nextAction };
            expect(
                await runCloud(host, [
                    'chat',
                    'start',
                    'Hello',
                    '--computer',
                    'computer-1',
                    '--browser-profile',
                    'profile-1',
                    '--yes',
                    '--json',
                ])
            ).toBe(code);
            expect(JSON.parse(stdout)).toEqual(chatResponse);
            expect(JSON.parse(stderr).error.fix).toBe(fix);
        }
    );

    it('prints the next human CLI command for a busy profile', async () => {
        chatResponse = {
            outcome: 'profile_busy',
            nextAction: { tool: 'dexto_chat_browser_profiles_list', arguments: {} },
        };
        expect(
            await runCloud(host, [
                'chat',
                'start',
                'Hello',
                '--browser-profile',
                'profile-1',
                '--yes',
                '--table',
            ])
        ).toBe(6);
        expect(stdout).toBe('');
        expect(stderr).toContain('dexto chat browser-profiles');
        expect(stderr).not.toContain('dexto_chat_browser_profiles_list');
    });

    it.each(['--browser-profile', '--computer'])(
        'requires headless consent for %s',
        async (choice) => {
            expect(
                await runCloud(host, ['chat', 'start', 'Hello', choice, 'profile-1', '--json'])
            ).toBe(4);
            expect(calls).toEqual([]);
            expect(JSON.parse(stderr).error.fix).toContain('--yes');
        }
    );

    it('asks for billing consent at a terminal', async () => {
        const prompts: string[] = [];
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                stdoutIsTerminal: true,
                prompt: async (question) => {
                    prompts.push(question);
                    return 'yes';
                },
            },
        };
        expect(
            await runCloud(host, ['chat', 'start', 'Hello', '--browser-profile', 'profile-1'])
        ).toBe(0);
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain('billed to your account');
        expect(calls.at(-1)?.params.arguments).toMatchObject({ confirm: true });
        expect(stdout).toContain('Started A task');
        expect(stdout).not.toContain('"session"');
    });

    it('asks for both permissions when selecting a computer and browser profile', async () => {
        const prompts: string[] = [];
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                stdoutIsTerminal: true,
                prompt: async (question) => {
                    prompts.push(question);
                    return 'yes';
                },
            },
        };
        expect(
            await runCloud(host, [
                'chat',
                'start',
                'Hello',
                '--computer',
                'computer-1',
                '--browser-profile',
                'profile-1',
            ])
        ).toBe(0);
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain('connected computer');
        expect(prompts[0]).toContain('billed to your account');
    });

    it('asks only for connected computer access when selecting a computer', async () => {
        const prompts: string[] = [];
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                stdoutIsTerminal: true,
                prompt: async (question) => {
                    prompts.push(question);
                    return 'yes';
                },
            },
        };
        expect(await runCloud(host, ['chat', 'start', 'Hello', '--computer', 'computer-1'])).toBe(
            0
        );
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain('connected computer');
        expect(prompts[0]).not.toContain('billed');
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('confirm');
    });

    it('requires consent in JSON mode for combined location choices', async () => {
        expect(
            await runCloud(host, [
                'chat',
                'start',
                'Hello',
                '--computer',
                'computer-1',
                '--browser-profile',
                'profile-1',
                '--json',
            ])
        ).toBe(4);
        expect(calls).toEqual([]);
        expect(JSON.parse(stderr).error.fix).toContain('--yes');
    });

    it('requires --yes under --json even at an interactive terminal', async () => {
        const prompts: string[] = [];
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                stdoutIsTerminal: true,
                prompt: async (question) => {
                    prompts.push(question);
                    return 'yes';
                },
            },
        };
        expect(
            await runCloud(host, [
                'chat',
                'start',
                'Hello',
                '--browser-profile',
                'profile-1',
                '--json',
            ])
        ).toBe(4);
        expect(prompts).toEqual([]);
        expect(calls).toEqual([]);
    });

    it.each([
        ['computers', 'Desk'],
        ['browser-profiles', 'Work'],
    ])('prints a readable table for chat %s', async (verb, name) => {
        expect(await runCloud(host, ['chat', verb, '--table'])).toBe(0);
        expect(stdout).toContain(name);
        expect(stdout).not.toContain('{');
    });

    it.each(['start', 'computers', 'browser-profiles'])(
        'rejects malformed output from chat %s',
        async (verb) => {
            chatResponse = { session: { id: 123 } };
            computersResponse = { computers: [{ id: 123 }] };
            profilesResponse = { profiles: [{ id: 123 }] };
            expect(
                await runCloud(host, ['chat', verb, ...(verb === 'start' ? ['Hello'] : [])])
            ).toBe(1);
            expect(stdout).toBe('');
            expect(JSON.parse(stderr).error.message).toContain("Dexto didn't return a valid");
        }
    );

    it("lists the workspace's apps, from the tools the Dexto MCP lists", async () => {
        expect(await runCloud(host, ['workspace'])).toBe(0);

        expect(JSON.parse(stdout).apps.map((app: { id: string }) => app.id)).toEqual([
            'chat',
            'email',
            'search',
            'sites',
        ]);
        expect(authorization[0]).toBe('Bearer access-1');
    });

    it("shows how a chat's last run ended in chat get and chat list", async () => {
        const lastRun = { id: 'run-1', status: 'failed' };
        chatInspection = {
            session: { id: 'chat-1', status: 'idle', lastRun },
            sessions: [
                { id: 'chat-1', status: 'idle', lastRun },
                { id: 'chat-2', status: 'idle', lastRun: null },
            ],
        };

        expect(
            await runCloud(host, ['workspace', 'chat', 'get', '--session-id', 'chat-1', '--json'])
        ).toBe(0);
        expect(JSON.parse(stdout).session.lastRun).toEqual(lastRun);
        stdout = '';
        expect(await runCloud(host, ['workspace', 'chat', 'list', '--json'])).toBe(0);
        expect(
            JSON.parse(stdout).sessions.map((chat: { lastRun: unknown }) => chat.lastRun)
        ).toEqual([lastRun, null]);
    });

    it('lists the tools with workspace tools', async () => {
        await runCloud(host, ['workspace', 'tools', '--search', 'email']);

        expect(JSON.parse(stdout).data.map((tool: { name: string }) => tool.name)).toEqual([
            'dexto_email_send',
        ]);
    });

    it.each([
        [
            'JSON envelope',
            JSON.stringify({ error: { code: 'service_busy', message: 'Try later' } }),
            'service_busy',
            'Try later',
        ],
        ['non-JSON body', 'unavailable', 'http_503', 'Dexto answered HTTP 503.'],
        ['empty body', '', 'http_503', 'Dexto answered HTTP 503.'],
    ])('preserves workspace HTTP errors from a %s', async (_kind, body, code, message) => {
        const failingHost: CloudHost = {
            ...host,
            runtime: {
                ...host.runtime,
                fetch: async (input, init) => {
                    const request = new globalThis.Request(input, init);
                    if (request.url === MCP) {
                        const rpc = JSON.parse(await request.clone().text());
                        if (rpc.method === 'tools/call')
                            return new Response(body, {
                                status: 503,
                                headers: { 'Retry-After': '2' },
                            });
                    }
                    return host.runtime.fetch(request);
                },
            },
        };
        expect(
            await runCloud(failingHost, [
                'workspace',
                'call',
                'dexto_email_send',
                '--data',
                '{"to":"a@b.c"}',
                '--yes',
                '--json',
            ])
        ).toBe(1);
        expect(JSON.parse(stderr).error).toMatchObject({ api_code: code, message });
    });

    it('asks before a call that acts, and passes confirm once agreed', async () => {
        const args = ['workspace', 'call', 'dexto_email_send', '--data', '{"to":"a@b.c"}'];

        expect(await runCloud(host, args)).toBe(4);
        expect(calls.some((call) => call.method === 'tools/call')).toBe(false);
        expect(JSON.parse(stderr).error.fix).toBe(
            `dexto workspace call dexto_email_send --data '{"to":"a@b.c"}' --yes`
        );

        expect(await runCloud(host, [...args, '--yes'])).toBe(0);
        expect(calls.at(-1)).toEqual({
            method: 'tools/call',
            params: { name: 'dexto_email_send', arguments: { to: 'a@b.c', confirm: true } },
        });
        expect(JSON.parse(stdout.slice(stdout.indexOf('{')))).toEqual({ status: 'sent' });
    });

    it('acts as a person only: an API key is told to sign in', async () => {
        environment.DEXTO_API_KEY = 'dxt_key';

        expect(await runCloud(host, ['workspace', 'tools'])).toBe(3);
        expect(JSON.parse(stderr).error.message).toContain("an API key can't use them");
        expect(calls).toHaveLength(0);
    });

    it('runs an app operation as dexto workspace <app> <operation> --field value', async () => {
        const code = await runCloud(host, ['workspace', 'email', 'send', '--to', 'a@b.c', '--yes']);

        expect(code).toBe(0);
        expect(calls.at(-1)).toEqual({
            method: 'tools/call',
            params: { name: 'dexto_email_send', arguments: { to: 'a@b.c', confirm: true } },
        });
    });

    it('answers an app it does not have with exit 2', async () => {
        expect(await runCloud(host, ['workspace', 'nope'])).toBe(2);
    });

    it('rejects invalid visibility before uploading', async () => {
        expect(
            await runCloud(host, ['publish', 'anything', '--visibility', 'team', '--yes', '--json'])
        ).toBe(2);
        expect(JSON.parse(stderr).error.message).toContain('--visibility');
        expect(uploads).toHaveLength(0);
        expect(calls).toHaveLength(0);
    });

    it('requires gateway access before uploading a Site', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, scopes: ['sites:write'] });
        expect(await runCloud(host, ['publish', 'anything', '--yes', '--json'])).toBe(3);
        expect(JSON.parse(stderr).error.message).toContain('cloud:write');
        expect(uploads).toHaveLength(0);
    });

    it('asks for both missing permissions before uploading', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, scopes: [] });
        expect(await runCloud(host, ['publish', 'anything', '--yes', '--json'])).toBe(3);
        const error = JSON.parse(stderr).error;
        expect(error.message).toContain('cloud:write');
        expect(error.message).toContain('sites:write');
        expect(uploads).toHaveLength(0);
    });

    it('requests both permissions in one interactive sign-in', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, scopes: [] });
        const granted: string[] = [];
        host = {
            ...host,
            runtime: { ...host.runtime, prompt: async () => 'yes', stdoutIsTerminal: true },
            signInForScope: async (_overrides, scopes) => {
                granted.push(scopes);
                await dextoAccounts.writeLogin(dir, 'default', {
                    ...login,
                    scopes: ['sites:write', 'cloud:write'],
                });
                return true;
            },
        };
        const file = path.join(path.dirname(dir), 'interactive.html');
        await writeFile(file, '<h1>hello</h1>');
        expect(await runCloud(host, ['publish', file, '--yes', '--table'])).toBe(0);
        expect(granted).toEqual(['sites:write,cloud:write']);
    });

    it('creates a public Site without an extra confirmation flag', async () => {
        const file = path.join(path.dirname(dir), 'public.html');
        await writeFile(file, '<h1>public</h1>');
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'public', '--yes', '--json'])
        ).toBe(0);
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('confirmPublicName');
        expect(JSON.parse(stdout).visibility).toBe('public');
    });

    it('reports the exact confirmation needed for an existing private Site', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        publishStatus = 409;
        publishResponse = {
            error: {
                code: 'needs_confirmation',
                message: 'Confirm the Site name "Team plan" before making it public.',
            },
        };
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'public', '--yes', '--json'])
        ).toBe(4);
        // Progress notes come first on stderr; the JSON error follows them.
        const failure = JSON.parse(stderr.slice(stderr.indexOf('{')));
        expect(failure.error.message).toContain('--confirm-public');
        expect(failure.error.message).toContain('Team plan');
        expect(calls.at(-1)?.params.name).toBe('POST /v1/sites/publish');
        expect(stdout).toBe('');
        stderr = '';
        expect(
            await runCloud(host, [
                'publish',
                file,
                '--visibility',
                'public',
                '--confirm-public',
                'Wrong',
                '--yes',
                '--json',
            ])
        ).toBe(4);
        expect(calls.at(-1)?.params.arguments).toMatchObject({ confirmPublicName: 'Wrong' });
        expect(JSON.parse(stderr.slice(stderr.indexOf('{'))).error.message).toContain('Team plan');
        expect(stdout).toBe('');
    });

    it('sends the explicit Site name to confirm a private-to-public change', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        expect(
            await runCloud(host, [
                'publish',
                file,
                '--visibility',
                'public',
                '--confirm-public',
                'Team plan',
                '--yes',
                '--json',
            ])
        ).toBe(0);
        expect(calls.at(-1)?.params.arguments).toMatchObject({
            visibility: 'public',
            confirmPublicName: 'Team plan',
        });
    });

    it('requires a Cloud project before uploading', async () => {
        const login = await dextoAccounts.readLogin(dir, 'default');
        if (login?.kind !== 'oauth') throw new Error('Expected OAuth login.');
        await dextoAccounts.writeLogin(dir, 'default', { ...login, cloudProject: null });
        expect(await runCloud(host, ['publish', 'anything', '--yes', '--json'])).toBe(2);
        expect(JSON.parse(stderr).error.message).toContain('--project');
        expect(uploads).toHaveLength(0);
    });

    it('refuses malformed or mismatched publish results', async () => {
        const file = path.join(path.dirname(dir), 'page.html');
        await writeFile(file, '<h1>private</h1>');
        publishResponse = { created: true };
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--json'])
        ).not.toBe(0);
        expect(stdout).toBe('');
        stderr = '';
        publishResponse = {
            created: false,
            files: 1,
            homepage: 'index.html',
            site: { id: 'site-1', slug: 'page', title: 'Page' },
            url: 'https://page.example',
            visibility: 'public',
        };
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--json'])
        ).not.toBe(0);
        expect(stdout).toBe('');
    });

    it('keeps omitted visibility omitted and sends the selected project', async () => {
        const file = path.join(path.dirname(dir), 'page.html');
        await writeFile(file, '<h1>update</h1>');
        expect(await runCloud(host, ['publish', file, '--yes', '--json'])).toBe(0);
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('visibility');
        expect(publishProject).toBe('project-1');
        expect(calls.some((call) => call.method === 'tools/list')).toBe(false);
        expect(stderr).toContain('unlisted: anyone with the link can open it');
        expect(JSON.parse(stdout).visibility).toBe('unlisted');
    });

    it('reports the effective visibility of an existing Site when --yes is used', async () => {
        const file = path.join(path.dirname(dir), 'existing.html');
        await writeFile(file, '<h1>Existing</h1>');
        publishResponse = {
            created: false,
            files: 1,
            homepage: 'index.html',
            site: { id: 'site-1', slug: 'page', title: 'Page' },
            url: 'https://page.example',
            visibility: 'private',
        };
        expect(await runCloud(host, ['publish', file, '--yes', '--json'])).toBe(0);
        expect(stderr).toContain('private: only you and your organization can open it');
        expect(JSON.parse(stdout).visibility).toBe('private');
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('visibility');
    });

    it('explains the default visibility before asking for publish consent', async () => {
        const file = path.join(path.dirname(dir), 'consent.html');
        await writeFile(file, '<h1>Consent</h1>');
        const questions: string[] = [];
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                prompt: async (question) => {
                    questions.push(question);
                    return 'yes';
                },
            },
        };
        expect(await runCloud(host, ['publish', file, '--json'])).toBe(0);
        expect(questions).toHaveLength(1);
        expect(questions[0]).toContain('new Site is unlisted');
        expect(questions[0]).toContain('anyone with the link can open it');
        expect(questions[0]).toContain('existing Site keeps its visibility');
        expect(calls.at(-1)?.params.arguments).not.toHaveProperty('visibility');
    });

    it('passes private visibility to the Site publish operation', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--json'])
        ).toBe(0);
        expect(calls.at(-1)?.params.arguments).toMatchObject({ visibility: 'private' });
        expect(stdout).not.toContain('Anyone with the link can open it');
        expect(JSON.parse(stdout).visibility).toBe('private');
    });

    it('describes a private Site correctly in human output', async () => {
        const file = path.join(path.dirname(dir), 'private.html');
        await writeFile(file, '<h1>private</h1>');
        expect(
            await runCloud(host, ['publish', file, '--visibility', 'private', '--yes', '--table'])
        ).toBe(0);
        expect(stdout).not.toContain('Anyone with the link can open it');
        expect(stdout).toContain('Open it from Dexto as an organization member.');
    });

    it('publishes a folder as a zip, uploaded where Dexto says, once agreed', async () => {
        const folder = path.join(path.dirname(dir), 'hello');
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, 'index.html'), '<h1>hi</h1>');
        await writeFile(path.join(folder, 'style.css'), 'h1{}');
        await writeFile(path.join(folder, '.secret'), 'left out');

        expect(await runCloud(host, ['publish', folder])).toBe(4);
        expect(uploads).toHaveLength(0);
        stderr = '';

        const code = await runCloud(host, ['publish', folder, '--yes', '--table']);

        expect(code).toBe(0);
        expect(uploads).toHaveLength(1);
        expect(uploads[0]?.method).toBe('PUT');
        expect(new globalThis.TextDecoder().decode(uploads[0]?.bytes.slice(0, 2))).toBe('PK');
        expect(calls.at(-1)).toEqual({
            method: 'POST',
            params: {
                name: 'POST /v1/sites/publish',
                arguments: { name: 'hello', uploadPath: 'uploads/u1.zip' },
            },
        });
        expect(stdout).toContain(
            'Published hello at https://hello.dexto.page (2 files). Anyone with the link can open it.'
        );
        // Progress goes to stderr, a line per step, so stdout keeps only the result.
        expect(stderr).toMatch(
            /Packed 2 files into a \d+ B \.zip\.\nUploading \d+ B…\nPublishing hello…\nSite visibility: unlisted: anyone with the link can open it\.\n$/u
        );
    });
});
