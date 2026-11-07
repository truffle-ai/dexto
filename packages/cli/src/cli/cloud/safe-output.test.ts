// Server text printed by cloud commands never reaches a terminal with control, bidi or invisible
// characters, on the plain and --json paths, and a command added later gets the same guard.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Command } from './command.js';
import { resolveConnection } from './connection.js';
import { CLOUD_GROUPS, cloudCommands } from './host.js';
import { runCloud, type CloudHost } from './run.js';
import type { CloudRuntime } from './runtime.js';

// ESC [2J (clear screen), OSC 0 (set title), a C1 CSI (U+009B), a right-to-left override
// (U+202E) and a C1 NEL (U+0085): each one is what a hostile server name could carry.
const HOSTILE = 'evil\u001B[2J\u001B]0;pwned\u0007\u009B31m\u202Egnp.exe\u0085end';
// What is left of it as text, and as escapes in JSON.
const CLEAN = 'evil[2J]0;pwned31mgnp.exeend';
const ESCAPED = '\\u009B31m\\u202Egnp.exe\\u0085end';

// A link a server could draw: OSC 8 with ESC and BEL, and with the C1 forms of OSC and ST.
const OSC8 = 'x\u001B]8;;https://evil.example\u0007click\u001B]8;;\u0007y';
const OSC8_CLEAN = 'x]8;;https://evil.exampleclick]8;;y';
const C1_OSC8 = 'x\u009D8;;https://evil.example\u009Cclick\u009D8;;\u009Cy';
const C1_OSC8_CLEAN = 'x8;;https://evil.exampleclick8;;y';

// Anything a terminal could act on, or that changes how text reads, once newlines are removed.
const UNSAFE =
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
const unsafe = (text: string): boolean => UNSAFE.test(text.replace(/\n/gu, ''));

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a key.');
};

describe('cloud output is safe at a terminal', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let terminal: boolean;
    let bytes: Uint8Array[];
    let reply: (url: string) => Response;
    let host: CloudHost;

    const sse = (events: readonly object[]): Response =>
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
            headers: { 'content-type': 'text/event-stream' },
        });

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-safe-output-')), 'accounts');
        stdout = '';
        stderr = '';
        terminal = true;
        bytes = [];
        reply = () => Response.json({});
        const runtime: CloudRuntime = {
            color: false,
            environment: { DEXTO_API_KEY: 'dxt_key' },
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => reply(new globalThis.Request(input, init).url),
            prompt: null,
            readStdin: async () => '',
            runProcess: async () => ({ exitCode: 0, output: '' }),
            signal: new AbortController().signal,
            sleep: async () => undefined,
            get stdoutIsTerminal() {
                return terminal;
            },
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

    describe('agents', () => {
        const agentReply = (events: readonly object[]) => (url: string) => {
            if (url.endsWith('/v1/agents/agt_1/sessions'))
                return Response.json({ id: 'ses_1' }, { status: 201 });
            if (url.endsWith('/sessions/ses_1/events')) return sse(events);
            if (url.endsWith('/sessions/ses_1/messages'))
                return Response.json({ id: 'run_1', status: 'queued' }, { status: 201 });
            return Response.json({}, { status: 404 });
        };
        const streamed = [
            { type: 'run.started', run_id: 'run_1', trigger: null },
            { type: 'message.delta', run_id: 'run_1', text: HOSTILE },
            { type: 'message.completed', run_id: 'run_1', message_id: 'm1', text: HOSTILE },
            {
                type: 'run.completed',
                run_id: 'run_1',
                stop_reason: 'completed',
                usage: { credits: 0, input_tokens: 1, output_tokens: 1 },
            },
        ];

        it('chat prints a streamed reply with its control and bidi characters taken out', async () => {
            reply = agentReply(streamed);

            const code = await runCloud(host, ['cloud', 'agents', 'chat', 'agt_1', 'hi']);

            expect(code).toBe(0);
            expect(stdout).toBe(`${CLEAN}\n`);
            expect(unsafe(stderr)).toBe(false);
        });

        it('chat prints a failed run, its code and message, cleaned', async () => {
            reply = agentReply([
                { type: 'run.started', run_id: 'run_1', trigger: null },
                {
                    type: 'run.failed',
                    run_id: 'run_1',
                    error: { code: `bad${HOSTILE}`, message: HOSTILE },
                },
            ]);

            const code = await runCloud(host, ['cloud', 'agents', 'chat', 'agt_1', 'hi']);

            expect(code).toBe(1);
            expect(stderr).toContain(`Run failed (bad${CLEAN}): ${CLEAN}\n`);
            expect(unsafe(stderr)).toBe(false);
        });

        it('chat --json prints each event as one JSON line that parses to the same data', async () => {
            reply = agentReply(streamed);

            await runCloud(host, ['cloud', 'agents', 'chat', 'agt_1', 'hi', '--json']);

            expect(unsafe(stdout)).toBe(false);
            expect(stdout).toContain(ESCAPED);
            const lines = stdout.trimEnd().split('\n');
            expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(streamed);
        });

        it('messages prints the role and each line of the text cleaned', async () => {
            reply = () =>
                Response.json({
                    data: [{ id: 'm1', role: `user${HOSTILE}`, text: `a\n${HOSTILE}\nb` }],
                    has_more: false,
                    next_after: null,
                });

            await runCloud(host, ['cloud', 'agents', 'messages', 'agt_1', 'ses_1', '--table']);

            expect(stdout).toBe(`user${CLEAN}: a\n${CLEAN}\nb\n\n`);
        });
    });

    describe('api', () => {
        it('prints a JSON response with the characters escaped and the data exact', async () => {
            const body = { name: HOSTILE, [HOSTILE]: 1 };
            reply = () => Response.json(body);

            const code = await runCloud(host, ['cloud', 'api', 'GET', '/v1/me']);

            expect(code).toBe(0);
            expect(unsafe(stdout)).toBe(false);
            expect(stdout).toContain(ESCAPED);
            expect(JSON.parse(stdout)).toEqual(body);
        });

        it('prints a body that is not JSON with them taken out at a terminal', async () => {
            reply = () =>
                new Response(`${HOSTILE}\n`, { headers: { 'content-type': 'text/plain' } });

            await runCloud(host, ['cloud', 'api', 'GET', '/v1/note']);

            expect(stdout).toBe(`${CLEAN}\n`);
        });

        it('cleans a body that is not JSON when stdout is piped too, for `| cat` and `| less -R`', async () => {
            terminal = false;
            reply = () =>
                new Response(`${HOSTILE}\n${OSC8}\n${C1_OSC8}`, {
                    headers: { 'content-type': 'text/plain' },
                });

            await runCloud(host, ['cloud', 'api', 'GET', '/v1/note']);

            expect(unsafe(stdout)).toBe(false);
            expect(stdout).toBe(`${CLEAN}\n${OSC8_CLEAN}\n${C1_OSC8_CLEAN}\n`);
        });

        it('gives exact data with --json when piped', async () => {
            terminal = false;
            const body = { name: HOSTILE, link: OSC8 };
            reply = () => Response.json(body);

            await runCloud(host, ['cloud', 'api', 'GET', '/v1/me']);

            expect(unsafe(stdout)).toBe(false);
            expect(JSON.parse(stdout)).toEqual(body);
        });
    });

    describe('sandboxes exec', () => {
        const result = {
            exit_code: 0,
            stdout: `out ${HOSTILE}\n`,
            stderr: `err ${HOSTILE}\n`,
            stdout_truncated: false,
            stderr_truncated: false,
        };

        it('prints the command output and its errors cleaned', async () => {
            reply = () => Response.json(result);

            await runCloud(host, ['cloud', 'sandboxes', 'exec', 'sbx_1', 'ls']);

            expect(stdout).toBe(`out ${CLEAN}\n`);
            expect(stderr).toBe(`err ${CLEAN}\n`);
        });

        it('with --json keeps the output exact as escaped JSON', async () => {
            reply = () => Response.json(result);

            await runCloud(host, ['cloud', 'sandboxes', 'exec', 'sbx_1', 'ls', '--json']);

            expect(unsafe(stdout)).toBe(false);
            expect(JSON.parse(stdout)).toEqual(result);
        });
    });

    describe('automations create', () => {
        const automation = {
            id: 'aut_1',
            name: HOSTILE,
            trigger: { type: 'webhook', url: `https://hooks.example/${HOSTILE}` },
            webhook_secret: HOSTILE,
        };
        const argv = [
            'cloud',
            'automations',
            'create',
            '--name',
            'Daily',
            '--agent',
            'agt_1',
            '--message',
            'Summarize',
            '--webhook',
        ];

        it('prints the name, URL and secret cleaned', async () => {
            reply = () => Response.json(automation, { status: 201 });

            await runCloud(host, argv);

            expect(unsafe(stdout)).toBe(false);
            expect(stdout).toContain(`Created automation aut_1 (${CLEAN}).`);
        });

        it('with --json keeps the record exact as escaped JSON', async () => {
            reply = () => Response.json(automation, { status: 201 });

            await runCloud(host, [...argv, '--json']);

            expect(unsafe(stdout)).toBe(false);
            expect(JSON.parse(stdout)).toEqual(automation);
        });
    });

    describe('files download', () => {
        const FILE_ID = '3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34';
        // Bytes that are not text at all: a terminal sequence, a bidi mark, invalid UTF-8.
        const content = Buffer.concat([
            Buffer.from(`${HOSTILE}\n${OSC8}\n`),
            Buffer.from([0x00, 0xff, 0xfe, 0x1b, 0x9b]),
        ]);
        let downloads: number;
        let serverPath: string;

        beforeEach(() => {
            downloads = 0;
            serverPath = 'a/b.bin';
            reply = (url) => {
                if (url.endsWith(`/v1/files/${FILE_ID}/content`)) {
                    downloads += 1;
                    return new Response(new Uint8Array(content), {
                        headers: { 'content-type': 'application/octet-stream' },
                    });
                }
                if (url.endsWith(`/v1/files/${FILE_ID}`))
                    return Response.json({ id: FILE_ID, path: serverPath });
                return Response.json({}, { status: 404 });
            };
        });

        for (const argv of [
            ['cloud', 'files', 'download', FILE_ID, '-'],
            ['cloud', 'files', 'download', FILE_ID, '-o', '-'],
            ['cloud', 'files', 'download', FILE_ID, '--output', '-'],
        ])
            it(`refuses to print to a terminal: ${argv.slice(3).join(' ')}`, async () => {
                const code = await runCloud(host, argv);

                expect(code).toBe(2);
                expect(stderr).toBe(
                    'Error: This file would be printed to your terminal. Use -o <path> to save it, or pipe it to a command.\n'
                );
                expect(Buffer.concat(bytes)).toHaveLength(0);
                expect(stdout).toBe('');
                expect(downloads).toBe(0);
            });

        // A name from the server is never stdout, nor a name that can't be a file.
        for (const name of ['-', '.', '..'])
            for (const piped of [false, true])
                it(`refuses a server file named ${name} saved by default, ${piped ? 'piped' : 'at a terminal'}`, async () => {
                    terminal = !piped;
                    serverPath = `a/${name}`;

                    const code = await runCloud(host, ['cloud', 'files', 'download', FILE_ID]);

                    expect(code).toBe(2);
                    expect(stderr).toContain(
                        "The file's name can't be used as a local name. Use -o <path> to say where to save it."
                    );
                    expect(Buffer.concat(bytes)).toHaveLength(0);
                    expect(stdout).toBe('');
                    expect(downloads).toBe(0);
                });

        it('still saves a server file named - where -o says', async () => {
            serverPath = 'a/-';
            const target = path.join(path.dirname(dir), 'named.bin');

            const code = await runCloud(host, [
                'cloud',
                'files',
                'download',
                FILE_ID,
                '-o',
                target,
            ]);

            expect(code).toBe(0);
            expect((await readFile(target)).equals(content)).toBe(true);
            expect(Buffer.concat(bytes)).toHaveLength(0);
        });

        it('sends the exact bytes to a pipe with -o -', async () => {
            terminal = false;

            const code = await runCloud(host, ['cloud', 'files', 'download', FILE_ID, '-o', '-']);

            expect(code).toBe(0);
            expect(Buffer.concat(bytes).equals(content)).toBe(true);
        });

        it('saves the exact bytes to the path -o names, at a terminal', async () => {
            const target = path.join(path.dirname(dir), 'saved.bin');

            const code = await runCloud(host, [
                'cloud',
                'files',
                'download',
                FILE_ID,
                '-o',
                target,
            ]);

            expect(code).toBe(0);
            expect((await readFile(target)).equals(content)).toBe(true);
            expect(Buffer.concat(bytes)).toHaveLength(0);
            expect(unsafe(stdout)).toBe(false);
        });
    });

    describe('a command added later', () => {
        // Writes server text straight through the runtime, as the commands this guards did.
        const added: Command = {
            path: ['cloud', 'added'],
            summary: 'A command nobody thought to sanitize.',
            async run(context) {
                context.runtime.writeOutput(`out ${HOSTILE}\n`);
                context.runtime.writeError(`err ${HOSTILE}\n`);
                context.runtime.writeOutput(JSON.stringify({ name: HOSTILE }));
            },
        };

        beforeEach(() => {
            host = { ...host, commands: [...host.commands, added] };
        });

        it('is cleaned at a terminal without doing anything', async () => {
            await runCloud(host, ['cloud', 'added']);

            expect(stdout.startsWith(`out ${CLEAN}\n`)).toBe(true);
            expect(stderr).toBe(`err ${CLEAN}\n`);
            expect(unsafe(stdout)).toBe(false);
            // Raw JSON.stringify output is filtered like any text, so it is still valid JSON.
            expect(JSON.parse(stdout.split('\n')[1] ?? '')).toMatchObject({
                name: expect.stringContaining('31mgnp.exeend'),
            });
        });

        it('is cleaned when stdout is piped too', async () => {
            terminal = false;

            await runCloud(host, ['cloud', 'added']);

            expect(stdout.startsWith(`out ${CLEAN}\n`)).toBe(true);
            expect(stderr).toBe(`err ${CLEAN}\n`);
            expect(unsafe(stdout)).toBe(false);
        });
    });
});
