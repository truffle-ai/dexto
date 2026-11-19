import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onTerminal } from '@dexto/tui/signal-harness';
import { resolveConnection } from './connection.js';
import { cloudCommands, CLOUD_GROUPS } from './host.js';
import type { SignInFor } from './commands/account.js';
import { runCloud, type CloudHost } from './run.js';
import type { CloudRuntime } from './runtime.js';

const API = 'https://api.dexto.ai';

function signedIn(overrides: Partial<dextoAccounts.OAuthLogin> = {}): dextoAccounts.OAuthLogin {
    return {
        kind: 'oauth',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: 'https://app.dexto.ai',
        apiBaseUrl: API,
        resource: 'https://app.dexto.ai/mcp',
        tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        scopes: ['cloud:read'],
        savedAt: '2026-11-01T00:00:00.000Z',
        signedInAs: null,
        cloudProject: { id: 'prj_main', name: 'Main' },
        ...overrides,
    };
}

const PROJECTS = {
    object: 'list',
    has_more: false,
    next_after: null,
    data: [
        {
            object: 'cloud_project',
            id: 'prj_main',
            name: 'Main',
            is_default: true,
            archived_at: null,
            created_at: '2026-11-01T00:00:00.000Z',
            updated_at: '2026-11-01T00:00:00.000Z',
        },
        {
            object: 'cloud_project',
            id: 'prj_side',
            name: 'Side',
            is_default: false,
            archived_at: null,
            created_at: '2026-11-01T00:00:00.000Z',
            updated_at: '2026-11-01T00:00:00.000Z',
        },
    ],
};

describe('dexto cloud', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let requests: globalThis.Request[];
    let reply: (request: globalThis.Request) => Response;
    let granted: (readonly string[])[];
    let host: CloudHost;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-cloud-')), 'accounts');
        stdout = '';
        stderr = '';
        requests = [];
        granted = [];
        reply = () => Response.json(PROJECTS);
        const runtime: CloudRuntime = {
            color: false,
            environment: {},
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                requests.push(request);
                return reply(request);
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
        const signIn: SignInFor = async (io) => ({
            ...io,
            dir,
            environment: {},
            appUrl: 'https://app.dexto.ai',
            apiBaseUrl: API,
            canOpenBrowser: true,
            interactive: false,
            chatSyncOn: async () => false,
            dexto: {
                signInWithBrowser: async () => signedIn(),
                signInWithDevice: async () => signedIn(),
                endSignIn: async () => ({ status: 'ended' }),
                refreshSignIn: async (login) => login,
                listProjects: async () => [],
                acceptsApiKey: async () => true,
            },
        });
        host = {
            commands: cloudCommands(dir, signIn),
            signIn,
            groups: CLOUD_GROUPS,
            runtime,
            resolveConnection: (overrides) =>
                resolveConnection({
                    dir,
                    environment: runtime.environment,
                    overrides,
                    refresh: async (login) => login,
                }),
            signInForScopes: async (_overrides, scopes) => {
                granted.push(scopes);
                return true;
            },
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('shows workspace help without signing in or making a request', async () => {
        expect(await runCloud(host, ['workspace', '--help'])).toBe(0);
        expect(stdout).toContain('workspace');
        expect(requests).toHaveLength(0);
    });

    it('shows publish scopes and an example in JSON help', async () => {
        expect(await runCloud(host, ['publish', '--help', '--json'])).toBe(0);
        expect(stdout).toContain('sites:write');
        expect(stdout).toContain('cloud:write');
        expect(stdout).toContain('dexto publish ./dist --yes');
    });

    it('shows the scope needed to start a chat', async () => {
        expect(await runCloud(host, ['chat', 'start', '--help', '--json'])).toBe(0);
        expect(stdout).toContain('sessions:write');
    });

    it('distinguishes the model catalog from account-available chat models', async () => {
        expect(await runCloud(host, ['models', 'list', '--help', '--json'])).toBe(0);
        expect(stdout).toContain('workspace chat models');
        expect(stdout).toContain('account');
    });

    it('explains where model outputs are saved and how to download them', async () => {
        expect(await runCloud(host, ['cloud', 'models', 'run', '--help', '--json'])).toBe(0);
        expect(stdout).toContain('Cloud files');
        expect(stdout).toContain('cloud files download');
    });

    it('states the cloud API path restriction in help', async () => {
        expect(await runCloud(host, ['cloud', 'api', '--help', '--json'])).toBe(0);
        expect(stdout).toContain('only /v1/');
    });

    it("lists projects as JSON with the sign-in's token and project", async () => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());

        const code = await runCloud(host, ['cloud', 'projects', 'list']);

        expect(code).toBe(0);
        expect(JSON.parse(stdout)).toEqual(PROJECTS);
        expect(requests[0]?.url).toBe(`${API}/v1/projects`);
        expect(requests[0]?.headers.get('authorization')).toBe('Bearer access-1');
        expect(requests[0]?.headers.get('dexto-cloud-project')).toBe('prj_main');
    });

    it('prints a table for people with --table, marking the current project', async () => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());

        await runCloud(host, ['cloud', 'projects', 'list', '--table']);

        expect(stdout.split('\n')[1]).toMatch(/^\*\s+prj_main\s+Main\s+yes/u);
    });

    it('acts in another project with --project, and sends a key as itself', async () => {
        await runCloud(host, ['cloud', 'projects', 'list', '--api-key', 'dxt_key']);
        expect(requests[0]?.headers.get('authorization')).toBe('Bearer dxt_key');
        expect(requests[0]?.headers.has('dexto-cloud-project')).toBe(false);

        await dextoAccounts.writeLogin(dir, 'default', signedIn());
        await runCloud(host, ['cloud', 'projects', 'list', '--project', 'prj_side']);
        expect(requests[1]?.headers.get('dexto-cloud-project')).toBe('prj_side');
    });

    it('reads the key from stdin with --api-key -, keeping it out of the command line', async () => {
        host = { ...host, runtime: { ...host.runtime, readStdin: async () => 'dxt_piped\n' } };

        const code = await runCloud(host, ['cloud', 'projects', 'list', '--api-key', '-']);

        expect(code).toBe(0);
        expect(requests[0]?.headers.get('authorization')).toBe('Bearer dxt_piped');
    });

    it('asks for the key, hidden, when --api-key has no value at a terminal', async () => {
        const asked: { question: string; secret: boolean }[] = [];
        host = {
            ...host,
            runtime: {
                ...host.runtime,
                prompt: async (question, options) => {
                    asked.push({ question, secret: options?.secret === true });
                    return 'dxt_typed';
                },
            },
        };

        await runCloud(host, ['cloud', 'projects', 'list', '--api-key', '--json']);

        expect(asked).toEqual([{ question: 'Dexto API key: ', secret: true }]);
        expect(requests[0]?.headers.get('authorization')).toBe('Bearer dxt_typed');
        expect(JSON.parse(stdout)).toEqual(PROJECTS);
    });

    it.each([
        [['chat', 'move', 'local-chat', '--to', 'cloud', '--json']],
        [['connect', 'linear', '--json']],
    ])('holds %j out of 2.0: usage exit 2, no request, no local agent', async (argv) => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());
        host = {
            ...host,
            openLocalAgent: async () => {
                throw new Error('a held command must not open a local agent');
            },
        };

        expect(await runCloud(host, argv)).toBe(2);
        expect(stdout).toBe('');
        expect(requests).toHaveLength(0);
    });

    it('registers neither held command, and keeps their released neighbours', () => {
        const registered = host.commands.map((command) => command.path.join(' '));

        expect(registered).not.toContain('chat move');
        expect(registered).not.toContain('connect');
        expect(registered).toEqual(
            expect.arrayContaining(['chat watch', 'connect claude', 'connect codex'])
        );
    });

    it('needs a sign-in: exit 3 with the command that fixes it', async () => {
        const code = await runCloud(host, ['cloud', 'projects', 'list']);

        expect(code).toBe(3);
        expect(JSON.parse(stderr)).toEqual({
            error: {
                code: 'needs_sign_in',
                message:
                    'Not signed in. Sign in, or set DEXTO_API_KEY to a developer key from your Cloud project.',
                fix: 'dexto login --device',
            },
        });
    });

    it.each(['cloud:write', 'computers:write', 'automations:write'])(
        'exits 3 headlessly naming %s and its explicit login command',
        async (scope) => {
            await dextoAccounts.writeLogin(dir, 'default', signedIn());
            reply = () =>
                Response.json(
                    {
                        error: {
                            code: 'forbidden',
                            message: `This needs ${scope}.`,
                            requestId: 'req_1',
                            retryable: false,
                            details: { scope },
                        },
                    },
                    { status: 403 }
                );

            const code = await runCloud(host, ['cloud', 'projects', 'create', 'New']);

            expect(code).toBe(3);
            expect(JSON.parse(stderr).error).toMatchObject({
                code: 'needs_permission',
                fix: `dexto login --device --scope ${scope}`,
            });
            expect(granted).toEqual([]);
        }
    );

    it('strips control characters from the API error on the plain stderr notes', async () => {
        // ESC[2J clears the screen, OSC 0 sets the title, CSI as one C1 byte sets a colour.
        const hostile = 'Evil\u001B[2J Org\u001B]0;pwned\u0007 \u009B31mInc';
        await dextoAccounts.writeLogin(dir, 'default', signedIn());
        reply = () =>
            Response.json(
                {
                    error: {
                        code: `expired${hostile}`,
                        message: `Session expired for ${hostile}.`,
                        requestId: 'req_3',
                        retryable: false,
                    },
                },
                { status: 401 }
            );

        const code = await runCloud(host, ['cloud', 'projects', 'list', '--table']);

        expect(code).toBe(3);
        // eslint-disable-next-line no-control-regex
        expect(stderr).not.toMatch(/[\u001B\u0007\u0080-\u009F]/u);
        expect(stderr).toContain(
            'Error (expiredEvil[2J Org]0;pwned 31mInc): Session expired for Evil[2J Org]0;pwned 31mInc.\n'
        );
        expect(stderr).toContain('Run: dexto login');
    });

    it('escapes control, bidi and invisible characters in plain error details', async () => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());
        reply = () =>
            Response.json(
                {
                    error: {
                        code: 'invalid',
                        message: 'Bad request.',
                        details: {
                            ['fi\u202Eeld']: 'invoice\u202Etxt.exe\u007F\u009B2J\u001B[2J\u200B',
                            nested: ['\u2066x\u2069'],
                        },
                        requestId: 'req_4',
                        retryable: false,
                    },
                },
                { status: 400 }
            );

        await runCloud(host, ['cloud', 'projects', 'list', '--table']);

        expect(stderr).not.toMatch(
            // eslint-disable-next-line no-control-regex
            /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B\u202E\u2066\u2069]/u
        );
        expect(stderr).toContain(
            '"fi\\u202Eeld": "invoice\\u202Etxt.exe\\u007F\\u009B2J\\u001b[2J\\u200B"'
        );
        expect(stderr).toContain('"\\u2066x\\u2069"');
        // Still pretty-printed: one field per line.
        expect(stderr).toMatch(/\{\n {2}"fi/u);
    });

    it('maps a missing resource to exit 5', async () => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());
        reply = () =>
            Response.json(
                {
                    error: {
                        code: 'not_found',
                        message: 'Not found.',
                        requestId: 'req_2',
                        retryable: false,
                    },
                },
                { status: 404 }
            );

        expect(await runCloud(host, ['cloud', 'api', 'GET', '/v1/agents/nope'])).toBe(5);
    });

    it.each(['computers:write', 'automations:write'])(
        'shows the full request as rows before a %s step-up and honors a decline',
        async (scope) => {
            await dextoAccounts.writeLogin(dir, 'default', {
                ...signedIn(),
                signedInAs: {
                    account: { email: 'sam@acme.co', id: 'acc_1', name: 'Sam Rivera' },
                    organization: { id: 'org_1', name: 'Acme', slug: 'acme' },
                },
            });
            reply = () =>
                Response.json(
                    {
                        error: {
                            code: 'forbidden',
                            message: `This needs ${scope}.`,
                            details: { scope },
                        },
                    },
                    { status: 403 }
                );
            const questions: string[] = [];
            const requested = [
                'cloud:read',
                'drive:read',
                'runs:read',
                'artifacts:read',
                'sessions:write',
                'projects:write',
                'drive:write',
                'chats:sync',
                scope,
            ];
            host = {
                ...host,
                runtime: {
                    ...host.runtime,
                    stdoutIsTerminal: true,
                    prompt: async (question) => {
                        questions.push(question);
                        return 'no';
                    },
                },
                signInForScopes: async (_overrides, extra, confirm) => {
                    if (!(await confirm(requested))) return false;
                    granted.push(extra);
                    return true;
                },
            };
            expect(await runCloud(host, ['cloud', 'projects', 'create', 'New', '--table'])).toBe(3);
            expect(questions).toEqual([
                [
                    `This needs ${scope}. Sign in again to request:`,
                    '  Account       sam@acme.co',
                    '  Organization  Acme',
                    `  From          this computer (${os.hostname()})`,
                    `  Access        9 permissions: ${requested.join(' ')}`,
                    'Continue? [y/N] ',
                ].join('\n'),
            ]);
            expect(granted).toEqual([]);
            expect(requests).toHaveLength(1);
        }
    );

    it('keeps cloud api on the public API', async () => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());

        expect(await runCloud(host, ['cloud', 'api', 'GET', 'https://evil.example/v1/x'])).toBe(2);
        expect(requests).toHaveLength(0);
    });

    it("switches the sign-in's project by name", async () => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());

        expect(await runCloud(host, ['cloud', 'projects', 'use', 'Side'])).toBe(0);

        const saved = await dextoAccounts.readLogin(dir, 'default');
        expect(saved?.kind === 'oauth' && saved.cloudProject).toEqual({
            id: 'prj_side',
            name: 'Side',
        });
    });

    it('answers an unknown command with exit 2, and help as JSON', async () => {
        expect(await runCloud(host, ['cloud', 'nope'])).toBe(2);

        stdout = '';
        expect(await runCloud(host, ['cloud', 'projects'])).toBe(0);
        expect(JSON.parse(stdout).commands.map((each: { usage: string }) => each.usage)).toEqual([
            'dexto cloud projects list',
            'dexto cloud projects create <name>',
            'dexto cloud projects use <project>',
        ]);
    });

    describe('who you are, your models and credits, under the same contract', () => {
        it('says who commands act as, as JSON', async () => {
            await dextoAccounts.writeLogin(dir, 'default', signedIn());

            expect(await runCloud(host, ['whoami'])).toBe(0);

            expect(JSON.parse(stdout)).toMatchObject({
                as: 'person',
                profile: 'default',
                cloud_project: { id: 'prj_main', name: 'Main' },
            });
        });

        it('is signed out with exit 3 and the command that signs in', async () => {
            expect(await runCloud(host, ['whoami'])).toBe(3);
            expect(JSON.parse(stderr)).toEqual({
                error: {
                    code: 'needs_sign_in',
                    message: 'Not signed in.',
                    fix: 'dexto login --device',
                },
            });
        });

        it('asks before removing a sign-in: exit 4 with the command that goes ahead', async () => {
            await dextoAccounts.writeLogin(dir, 'work', signedIn());

            expect(await runCloud(host, ['accounts', 'remove', 'work'])).toBe(4);
            expect(JSON.parse(stderr).error.fix).toBe('dexto accounts remove work --yes');
            expect(await dextoAccounts.readLogin(dir, 'work')).not.toBeNull();
        });

        it('lists the models Dexto serves as dexto/<model>', async () => {
            await dextoAccounts.writeLogin(dir, 'default', signedIn());
            reply = () =>
                Response.json({
                    object: 'list',
                    data: [{ id: 'openai/gpt-5', name: 'GPT-5', context_window: 400000 }],
                });

            expect(await runCloud(host, ['models', 'list'])).toBe(0);

            expect(JSON.parse(stdout).data.map((model: { id: string }) => model.id)).toEqual([
                'dexto/openai/gpt-5',
            ]);
            expect(requests[0]?.url).toBe(`${API}/v1/models`);
        });
    });

    describe('on Signal, for people at a terminal', () => {
        const savedIsTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
        const stderrIsTTY = (isTTY: boolean) =>
            Object.defineProperty(process.stderr, 'isTTY', { value: isTTY, configurable: true });
        const notFound = () =>
            Response.json(
                {
                    error: {
                        code: 'not_found',
                        message: 'Not found.',
                        requestId: 'req_2',
                        retryable: false,
                    },
                },
                { status: 404 }
            );

        beforeEach(() => {
            host = { ...host, runtime: { ...host.runtime, stdoutIsTerminal: true } };
            stderrIsTTY(false);
        });

        afterEach(() => {
            if (savedIsTTY === undefined) Reflect.deleteProperty(process.stderr, 'isTTY');
            else Object.defineProperty(process.stderr, 'isTTY', savedIsTTY);
        });

        const onSignal = (argv: readonly string[]) =>
            onTerminal('16-dark', () => runCloud(host, argv));

        it('prints a failure as the fault block, plain when stderr is piped', async () => {
            await dextoAccounts.writeLogin(dir, 'default', signedIn());
            reply = notFound;

            expect(await onSignal(['cloud', 'api', 'GET', '/v1/agents/nope'])).toBe(5);
            expect(stderr).toBe('  ▌ FAULT   HTTP 404: Not found.\n');

            stderr = '';
            await dextoAccounts.forgetLogin(dir, 'default');
            expect(await onSignal(['cloud', 'projects', 'list'])).toBe(3);
            expect(stderr).toBe(
                [
                    '  ▌ FAULT   Not signed in. Sign in, or set DEXTO_API_KEY to a developer key from your Cloud project.',
                    '  ▌ next    dexto login --device',
                    '',
                ].join('\n')
            );
        });

        it('keeps the colour when stderr is a terminal', async () => {
            await dextoAccounts.writeLogin(dir, 'default', signedIn());
            reply = notFound;
            stderrIsTTY(true);

            expect(await onSignal(['cloud', 'api', 'GET', '/v1/agents/nope'])).toBe(5);

            expect(stderr).toContain('\u001B[');
            expect(stderr).toContain('FAULT');
        });

        it('points a usage mistake at help instead of printing it', async () => {
            expect(await onSignal(['cloud', 'nope'])).toBe(2);
            expect(stderr).toBe(
                [
                    '  ▌ FAULT   Unknown command: dexto cloud nope',
                    '',
                    '  every command: dexto --help',
                    '',
                ].join('\n')
            );

            stderr = '';
            await dextoAccounts.writeLogin(dir, 'default', signedIn());
            expect(await onSignal(['cloud', 'projects', 'create'])).toBe(2);
            expect(stderr).toBe(
                [
                    '  ▌ FAULT   Missing arguments: <name>',
                    '',
                    '  this command: dexto cloud projects create --help',
                    '',
                ].join('\n')
            );
        });

        it('exits with the same codes as without Signal', async () => {
            const codes = async (run: (argv: readonly string[]) => Promise<number>) => [
                await run(['cloud', 'nope']),
                await run(['cloud', 'projects', 'list']),
                await run(['whoami']),
            ];

            const plain = await codes((argv) => runCloud(host, argv));
            expect(stderr).not.toContain('FAULT');
            stderr = '';
            const signal = await codes(onSignal);

            expect(signal).toEqual(plain);
            expect(signal).toEqual([2, 3, 3]);
            expect(stderr).toContain('▌ FAULT');
        });
    });
});
