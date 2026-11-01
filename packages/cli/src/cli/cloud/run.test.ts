import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    let granted: string[];
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
            signInForScope: async (_overrides, scope) => {
                granted.push(scope);
                return true;
            },
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
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

    it("names the permission a sign-in lacks and how to grant it, from the API's refusal", async () => {
        await dextoAccounts.writeLogin(dir, 'default', signedIn());
        reply = () =>
            Response.json(
                {
                    error: {
                        code: 'forbidden',
                        message: 'This needs cloud:write.',
                        requestId: 'req_1',
                        retryable: false,
                        details: { scope: 'cloud:write' },
                    },
                },
                { status: 403 }
            );

        const code = await runCloud(host, ['cloud', 'projects', 'create', 'New']);

        expect(code).toBe(3);
        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'needs_permission',
            fix: 'dexto login --device --scope cloud:write',
        });
        expect(granted).toEqual([]);
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
                error: { code: 'needs_sign_in', message: 'Not signed in.', fix: 'dexto login' },
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
});
