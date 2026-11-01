import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

describe('cloud secrets, web and data-deletions', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let stdin: string;
    let bytes: Uint8Array[];
    let requests: { method: string; url: string; body: unknown; headers: globalThis.Headers }[];
    let reply: (url: string) => Response;
    let host: CloudHost;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-cloud-cmd-')), 'accounts');
        stdout = '';
        stderr = '';
        stdin = '';
        bytes = [];
        requests = [];
        reply = () => Response.json({});
        const runtime: CloudRuntime = {
            color: false,
            environment: { DEXTO_API_KEY: 'dxt_key' },
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                const text = await request.text();
                const isJson =
                    request.headers.get('content-type')?.includes('json') ?? text.startsWith('{');
                requests.push({
                    method: request.method,
                    url: request.url,
                    body: text.length === 0 ? null : isJson ? JSON.parse(text) : text,
                    headers: request.headers,
                });
                return reply(request.url);
            },
            prompt: null,
            readStdin: async () => stdin,
            runProcess: async () => ({ exitCode: 0, output: '' }),
            signal: new AbortController().signal,
            sleep: async () => undefined,
            stdoutIsTerminal: false,
            writeBytes: async (chunk) => {
                bytes.push(chunk);
            },
            writeError: (text) => {
                stderr += text;
            },
            writeOutput: (text) => {
                stdout += text;
            },
        };
        host = {
            commands: cloudCommands(dir),
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

    it('creates a secret from stdin, never from an argument, sent as a bearer by default', async () => {
        stdin = 'ghp_value\n';
        reply = () => Response.json({ id: 'sec_1', name: 'GITHUB' }, { status: 201 });

        const code = await runCloud(host, [
            'cloud',
            'secrets',
            'create',
            'GITHUB',
            '--host',
            'api.github.com',
        ]);

        expect(code).toBe(0);
        expect(requests[0]).toMatchObject({
            method: 'POST',
            url: 'https://api.dexto.ai/v1/secrets',
            body: {
                hosts: ['api.github.com'],
                name: 'GITHUB',
                placement: { type: 'bearer' },
                value: 'ghp_value',
            },
        });
    });

    it('sends a secret in a named header with --header and --prefix', async () => {
        stdin = 'v';
        reply = () => Response.json({ id: 'sec_2', name: 'X' }, { status: 201 });

        await runCloud(host, [
            'cloud',
            'secrets',
            'create',
            'X',
            '--header',
            'Authorization',
            '--prefix',
            'Token ',
        ]);

        expect(requests[0]?.body).toMatchObject({
            placement: { type: 'header', name: 'Authorization', prefix: 'Token ' },
        });
    });

    it('asks before deleting: without --yes and no one to ask, exit 4 and nothing sent', async () => {
        const code = await runCloud(host, ['cloud', 'secrets', 'delete', 'sec_1']);

        expect(code).toBe(4);
        expect(requests).toHaveLength(0);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'needs_confirmation',
            fix: 'dexto cloud secrets delete sec_1 --yes',
        });

        reply = () => Response.json({ id: 'sec_1', object: 'secret', deleted: true });
        expect(await runCloud(host, ['cloud', 'secrets', 'delete', 'sec_1', '--yes'])).toBe(0);
        expect(requests[0]).toMatchObject({
            method: 'DELETE',
            url: 'https://api.dexto.ai/v1/secrets/sec_1',
        });
    });

    it('searches the web with the wire names', async () => {
        reply = () => Response.json({ id: 's', object: 'search', results: [], usage: {} });

        await runCloud(host, ['cloud', 'search', 'dexto', 'cli', '--num', '3']);

        expect(requests[0]?.body).toEqual({ query: 'dexto cli', num_results: 3 });
    });

    it('fails a fetch when a page failed, after printing the rest', async () => {
        reply = () =>
            Response.json({
                id: 'f',
                object: 'fetch',
                usage: {},
                results: [
                    { url: 'https://a.example', status: 'ok', title: 'A', text: 'hello' },
                    { url: 'https://b.example', status: 'error', error: { code: 'timeout' } },
                ],
            });

        const code = await runCloud(host, [
            'cloud',
            'fetch',
            'https://a.example',
            'https://b.example',
            '--max-chars',
            '500',
        ]);

        expect(code).toBe(1);
        expect(requests[0]?.body).toEqual({
            urls: ['https://a.example', 'https://b.example'],
            max_characters: 500,
        });
        expect(stdout).toContain('# A\nhttps://a.example\n\nhello');
        expect(stdout).toContain('Failed: timeout');
    });

    it('needs --user or --agent to delete data', async () => {
        expect(await runCloud(host, ['cloud', 'data-deletions', 'create', '--yes'])).toBe(2);
        expect(requests).toHaveLength(0);
    });

    describe('models', () => {
        const textModel = {
            id: 'openai/gpt-5',
            name: 'GPT-5',
            object: 'model',
            capabilities: {
                input: ['text'],
                output: ['text'],
                maxInputTokens: 400000,
                reasoning: true,
                supportsToolCall: true,
            },
            pricing: { inputPerM: 1.25, outputPerM: 10, contextOver200kPerM: null },
        };
        const mediaModel = {
            id: 'fal/flux',
            title: 'Flux',
            description: 'Images',
            media_kind: 'image',
            input: {
                fields: [{ name: 'prompt', type: 'string', description: '' }],
                required: ['prompt'],
            },
            pricing: {
                currency: 'usd',
                estimate_mode: 'fixed',
                unit: 'image',
                unit_price_usd: 0.04,
            },
        };
        const run = (completed: boolean) => ({
            id: 'gen_1',
            model: 'fal/flux',
            media_kind: 'image',
            status: completed ? 'succeeded' : 'running',
            completed,
            error: null,
            created_at: '2026-11-01T00:00:00.000Z',
            resources: completed
                ? [
                      {
                          id: 'r1',
                          file_path: null,
                          filename: 'flux.png',
                          url: 'https://cdn.example/flux.png',
                      },
                  ]
                : [],
        });
        let polls: number;

        beforeEach(() => {
            polls = 0;
            reply = (url) => {
                if (url.endsWith('/v1/models'))
                    return Response.json({ object: 'list', data: [textModel] });
                if (url.endsWith('/v1/media/models'))
                    return Response.json({ object: 'list', data: [mediaModel] });
                if (url.endsWith('/v1/media/estimates'))
                    return Response.json({
                        id: 'est_1',
                        amount_usd: 0.04,
                        confidence: 'exact',
                        explanation: '1 image',
                    });
                if (url.endsWith('/v1/media/generations'))
                    return Response.json(run(false), { status: 201 });
                if (url.endsWith('/v1/media/generations/gen_1'))
                    return Response.json(run(++polls > 1));
                if (url.endsWith('/v1/chat/completions'))
                    return Response.json({
                        id: 'c',
                        object: 'chat.completion',
                        choices: [
                            {
                                index: 0,
                                finish_reason: 'stop',
                                message: { role: 'assistant', content: 'Hi there' },
                            },
                        ],
                    });
                return Response.json({}, { status: 404 });
            };
        });

        it('lists text and media models together, and filters by kind', async () => {
            await runCloud(host, ['cloud', 'models', 'list']);
            expect(JSON.parse(stdout).data.map((model: { id: string }) => model.id)).toEqual([
                'openai/gpt-5',
                'fal/flux',
            ]);

            stdout = '';
            await runCloud(host, ['cloud', 'models', 'list', '--type', 'image']);
            expect(JSON.parse(stdout).data.map((model: { id: string }) => model.id)).toEqual([
                'fal/flux',
            ]);
        });

        it('runs a text model with a system prompt and prints its reply', async () => {
            const code = await runCloud(host, [
                'cloud',
                'models',
                'run',
                'openai/gpt-5',
                'say',
                'hi',
                '--system',
                'Be brief',
            ]);

            expect(code).toBe(0);
            expect(requests.at(-1)?.body).toEqual({
                model: 'openai/gpt-5',
                messages: [
                    { role: 'system', content: 'Be brief' },
                    { role: 'user', content: 'say hi' },
                ],
            });
            expect(stdout).toBe('Hi there\n');
        });

        it('prices a media run and asks first: without --yes, exit 4 and nothing generated', async () => {
            const code = await runCloud(host, ['cloud', 'models', 'run', 'fal/flux', 'a cat']);

            expect(code).toBe(4);
            expect(requests.some((request) => request.url.endsWith('/v1/media/generations'))).toBe(
                false
            );
            expect(stderr).toContain('Estimated $0.04 (exact): 1 image');
        });

        it('starts a media run once agreed, idempotently, and waits for it', async () => {
            const code = await runCloud(host, [
                'cloud',
                'models',
                'run',
                'fal/flux',
                'a cat',
                '--yes',
                '--table',
            ]);

            expect(code).toBe(0);
            const start = requests.find((request) => request.url.endsWith('/v1/media/generations'));
            expect(start?.body).toEqual({ estimate_id: 'est_1' });
            expect(start?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/u);
            expect(stdout).toBe('Run gen_1 succeeded.\nflux.png  https://cdn.example/flux.png\n');
        });
    });

    describe('sandboxes and files', () => {
        it('runs a command, passing its output and exit code through', async () => {
            reply = () =>
                Response.json({
                    exit_code: 3,
                    stdout: 'out\n',
                    stderr: 'err\n',
                    stdout_truncated: false,
                    stderr_truncated: false,
                });

            const code = await runCloud(host, [
                'cloud',
                'sandboxes',
                'exec',
                'sbx_1',
                '--',
                'ls',
                '-la',
            ]);

            expect(code).toBe(3);
            expect(requests[0]).toMatchObject({
                url: 'https://api.dexto.ai/v1/sandboxes/sbx_1/processes',
                body: { command: 'ls -la' },
            });
            expect(stdout).toBe('out\n');
            expect(stderr).toBe('err\n');
        });

        it('creates a sandbox idempotently', async () => {
            reply = () =>
                Response.json({ id: 'sbx_1', name: 'dev', status: 'not_started' }, { status: 201 });

            await runCloud(host, ['cloud', 'sandboxes', 'create', 'dev']);

            expect(requests[0]?.body).toEqual({ name: 'dev', size: 'large' });
            expect(requests[0]?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/u);
        });

        it('uploads a small file in one request with its hash, type and length', async () => {
            const local = path.join(path.dirname(dir), 'notes.md');
            await writeFile(local, '# hi\n');
            reply = () => Response.json({ id: 'f1', path: 'docs/notes.md', size_bytes: 5 });

            const code = await runCloud(host, [
                'cloud',
                'files',
                'upload',
                local,
                'docs/notes.md',
                '--overwrite',
            ]);

            expect(code).toBe(0);
            expect(requests[0]?.url).toBe(
                'https://api.dexto.ai/v1/files?path=docs%2Fnotes.md&overwrite=true'
            );
            expect(requests[0]?.body).toBe('# hi\n');
            expect(requests[0]?.headers.get('content-type')).toBe('text/markdown');
            expect(requests[0]?.headers.get('content-length')).toBe('5');
            expect(requests[0]?.headers.get('x-content-sha256')).toBe(
                createHash('sha256').update('# hi\n').digest('hex')
            );
        });

        it('finds a file by path and downloads it to stdout', async () => {
            reply = (url) => {
                if (url.includes('/v1/files?'))
                    return Response.json({
                        object: 'list',
                        has_more: false,
                        next_after: null,
                        data: [{ id: 'f1', path: 'docs/notes.md' }],
                    });
                if (url.endsWith('/v1/files/f1'))
                    return Response.json({ id: 'f1', path: 'docs/notes.md' });
                if (url.endsWith('/v1/files/f1/content'))
                    return new Response('# hi\n', {
                        headers: { 'content-type': 'application/octet-stream' },
                    });
                return Response.json({}, { status: 404 });
            };

            const code = await runCloud(host, ['cloud', 'files', 'download', 'docs/notes.md', '-']);

            expect(code).toBe(0);
            expect(requests[0]?.url).toBe(
                'https://api.dexto.ai/v1/files?limit=1000&prefix=docs%2Fnotes.md'
            );
            expect(Buffer.concat(bytes).toString('utf8')).toBe('# hi\n');
        });
    });

    describe('agents and automations', () => {
        function sse(events: readonly object[]): Response {
            return new Response(
                events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
                {
                    headers: { 'content-type': 'text/event-stream' },
                }
            );
        }

        it('chats: starts a session, sends the message and streams the reply', async () => {
            reply = (url) => {
                if (url.endsWith('/v1/agents/agt_1/sessions'))
                    return Response.json({ id: 'ses_1' }, { status: 201 });
                if (url.endsWith('/sessions/ses_1/events'))
                    return sse([
                        { type: 'run.started', run_id: 'run_1', trigger: null },
                        { type: 'message.delta', run_id: 'run_1', text: 'Hel' },
                        { type: 'message.delta', run_id: 'run_1', text: 'lo' },
                        {
                            type: 'message.completed',
                            run_id: 'run_1',
                            message_id: 'm1',
                            text: 'Hello',
                        },
                        {
                            type: 'run.completed',
                            run_id: 'run_1',
                            stop_reason: 'completed',
                            usage: { credits: 0.01, input_tokens: 10, output_tokens: 2 },
                        },
                    ]);
                if (url.endsWith('/sessions/ses_1/messages'))
                    return Response.json({ id: 'run_1', status: 'queued' }, { status: 201 });
                return Response.json({}, { status: 404 });
            };

            const code = await runCloud(host, ['cloud', 'agents', 'chat', 'agt_1', 'hi', 'there']);

            expect(code).toBe(0);
            expect(stdout).toBe('Hello\n');
            expect(requests.find((request) => request.url.endsWith('/messages'))?.body).toEqual({
                content: 'hi there',
            });
            expect(requests[0]?.body).toEqual({ user: 'cli' });
            expect(stderr).toContain('Session ses_1');
        });

        it('stops at an approval no one here can decide: exit 4 and how to decide it', async () => {
            reply = (url) => {
                if (url.endsWith('/sessions/ses_1/events'))
                    return sse([
                        {
                            type: 'approval.requested',
                            run_id: 'run_1',
                            approval_id: 'apr_1',
                            tool_name: 'send_email',
                            input: { to: 'a@b.c' },
                            tool_call_id: 't1',
                        },
                    ]);
                if (url.endsWith('/sessions/ses_1/messages'))
                    return Response.json({ id: 'run_1' }, { status: 201 });
                return Response.json({}, { status: 404 });
            };

            const code = await runCloud(host, [
                'cloud',
                'agents',
                'chat',
                'agt_1',
                'send it',
                '--session',
                'ses_1',
            ]);

            expect(code).toBe(4);
            expect(stderr).toContain('dexto cloud agents approve agt_1 ses_1 apr_1');
            expect(requests.some((request) => request.url.includes('/approvals/'))).toBe(false);
        });

        it('creates a recurring automation from flags', async () => {
            reply = () =>
                Response.json(
                    {
                        id: 'aut_1',
                        name: 'Daily',
                        trigger: { type: 'schedule', next_run_at: '2026-11-02T09:00:00Z' },
                    },
                    { status: 201 }
                );

            await runCloud(host, [
                'cloud',
                'automations',
                'create',
                '--name',
                'Daily',
                '--agent',
                'agt_1',
                '--message',
                'Summarize',
                '--cron',
                '0 9 * * *',
                '--timezone',
                'Europe/London',
            ]);

            expect(requests[0]?.body).toEqual({
                name: 'Daily',
                target: { agent_id: 'agt_1', message: 'Summarize', type: 'agent' },
                trigger: {
                    type: 'schedule',
                    schedule: { cron: '0 9 * * *', timezone: 'Europe/London', type: 'recurring' },
                },
            });
        });

        it('needs exactly one trigger', async () => {
            const code = await runCloud(host, [
                'cloud',
                'automations',
                'create',
                '--name',
                'X',
                '--agent',
                'a',
                '--message',
                'm',
                '--cron',
                '* * * * *',
                '--webhook',
            ]);

            expect(code).toBe(2);
            expect(requests).toHaveLength(0);
        });
    });

    describe('sites and functions', () => {
        let packed: object;
        let ran: { command: string; args: readonly string[]; cwd: string }[];

        beforeEach(() => {
            packed = { assets: [{ path: 'index.html' }] };
            ran = [];
            host = {
                ...host,
                runtime: {
                    ...host.runtime,
                    runProcess: async (command, args, options) => {
                        ran.push({ command, args, cwd: options.cwd });
                        const out = args[args.indexOf('--out') + 1] ?? '';
                        await writeFile(out, JSON.stringify(packed));
                        return { exitCode: 0, output: '' };
                    },
                },
            };
        });

        it("deploys a Site packed with the project's own packer, live by default", async () => {
            const project = path.join(path.dirname(dir), 'site');
            await mkdir(path.join(project, '.dexto'), { recursive: true });
            await writeFile(path.join(project, '.dexto', 'pack.mjs'), '');
            reply = () =>
                Response.json({
                    deployment: { id: 'dep_1' },
                    promoted: true,
                    site: { id: 'site_1', slug: 'hello' },
                    url: 'https://hello.dexto.site',
                });

            const code = await runCloud(host, ['cloud', 'sites', 'deploy', project, '--table']);

            expect(code).toBe(0);
            expect(ran[0]).toMatchObject({ command: 'node', cwd: project });
            expect(ran[0]?.args.slice(0, 2)).toEqual([path.join('.dexto', 'pack.mjs'), '.']);
            expect(requests[0]).toMatchObject({
                method: 'POST',
                url: 'https://api.dexto.ai/v1/sites/deployments?promote=true',
                body: packed,
            });
            expect(stdout).toBe('Deployed hello to https://hello.dexto.site (deployment dep_1).\n');
        });

        it('refuses to deploy a Function as a Site', async () => {
            packed = { entry: 'index.js' };
            expect(await runCloud(host, ['cloud', 'sites', 'deploy', path.dirname(dir)])).toBe(2);
            expect(requests).toHaveLength(0);
        });

        it("names the permissions a person's sign-in lacks before packing anything", async () => {
            host = {
                ...host,
                runtime: { ...host.runtime, environment: {} },
                resolveConnection: (overrides) =>
                    resolveConnection({
                        dir,
                        environment: {},
                        overrides,
                        refresh: async (login: dextoAccounts.OAuthLogin) => login,
                    }),
            };
            await dextoAccounts.writeLogin(dir, 'default', {
                kind: 'oauth',
                accessToken: 'a',
                refreshToken: 'r',
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                clientId: 'dexto-cli',
                appUrl: 'https://app.dexto.ai',
                apiBaseUrl: 'https://api.dexto.ai',
                resource: 'https://app.dexto.ai/mcp',
                tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
                scopes: ['cloud:read'],
                savedAt: '2026-11-01T00:00:00.000Z',
                signedInAs: null,
                cloudProject: { id: 'prj_main', name: 'Main' },
            });

            const code = await runCloud(host, ['cloud', 'sites', 'deploy']);

            expect(code).toBe(3);
            expect(JSON.parse(stderr).error.fix).toBe(
                'dexto login --device --scope sites:write,cloud:write'
            );
            expect(ran).toHaveLength(0);
        });
    });
});
