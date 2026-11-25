// Every list command prints one JSON shape (DEXTO-3899): `{data, has_more, next_after}`, every key
// snake_case except inside data values, run against a fake Dexto MCP and `/v1` API.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isJsonObject, type Command } from './command.js';
import { resolveConnection } from './connection.js';
import { cloudCommands, CLOUD_GROUPS } from './host.js';
import { runCloud, type CloudHost } from './run.js';
import type { CloudRuntime } from './runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const API = 'https://api.dexto.ai';
const ID = '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80';
const CHAT = '0b0e6a52-2c55-4c1d-8a43-2f3f7a9e1c11';
const SITE = '2d1c9a77-5b3e-4f0a-8c6d-1e2f3a4b5c6d';
const RUN = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const AT = '2026-11-24T09:00:00.000Z';
const SCOPES = [
    'agents:read',
    'apps:read',
    'applications:read',
    'artifacts:read',
    'autobots:read',
    'automations:read',
    'cloud:read',
    'computers:read',
    'connections:read',
    'contacts:read',
    'contacts:write',
    'functions:read',
    'marketplace:read',
    'messages:read',
    'network:read',
    'notifications:read',
    'projects:read',
    'sessions:read',
    'sites:read',
    'skills:read',
];

/**
 * The keys `jsonKeys` in output.ts leaves as they are: someone's data, sent back unchanged. A copy
 * on purpose, so a change to the printed contract has to change this test too.
 */
const DATA_KEYS: ReadonlySet<string> = new Set([
    '_meta',
    'arguments',
    'confirm_schema',
    'env',
    'headers',
    'input',
    'input_schema',
    'metadata',
    'output_schema',
    'schema',
    'value',
    'variables',
]);
const CAMEL_CASE = /^[a-z][a-z0-9]*[A-Z]/u;

/**
 * List commands that print nothing from Dexto: they read this machine, so no fake server reaches
 * them.
 */
const SKIPPED: ReadonlySet<string> = new Set([
    // Saved sign-ins under ~/.dexto/accounts, listed by the sign-in context.
    'accounts list',
    // Claude Code and Codex chats found in this machine's files.
    'import list',
]);

/** List commands whose last word isn't `list`. */
const OTHER_LISTS = [
    'apps uninstalled',
    'autobots status',
    'chat agents',
    'chat browser-profiles',
    'chat computers',
    'chat models',
    'chat outputs',
    'cloud agents messages',
    'cloud agents runs steps',
    'cloud automations firings',
    'cloud sandboxes import',
    'cloud sandboxes ls',
    'docs search',
    'find',
    'marketplace search',
    'projects recipes',
    'skills versions',
    'workspace contacts requests',
    'workspace contacts search',
    'workspace share received',
    'workspace tools',
];

/** A `/v1` page, as the API answers a list. */
function page(data: unknown[], more: Record<string, unknown> = {}) {
    return { object: 'list', data, has_more: false, next_after: null, ...more };
}

const RECORD = { id: ID, createdAt: AT, updatedAt: AT, value: { firstName: 'Ada' } };
const PERSON = { handle: 'ada', name: 'Ada', organization: null, organizationId: ID, userId: ID };
const SHARED = {
    owner: { displayName: 'Ada', handle: 'ada' },
    target: { kind: 'drive', fileId: ID },
    title: 'Plan',
    url: 'https://app.dexto.ai/s/1',
};

/** One case per list command: its words, and the server's answers by tool, method or `/v1` path. */
const CASES: readonly { argv: readonly string[]; replies: Record<string, unknown> }[] = [
    {
        argv: ['loops', 'list'],
        replies: {
            dexto_automations_list: {
                automations: [
                    { id: ID, name: 'Triage', enabled: true, nextRunAt: AT, scheduleType: 'cron' },
                ],
                nextCursor: 'c2',
            },
        },
    },
    {
        argv: ['apps', 'list'],
        replies: {
            dexto_apps_list: {
                apps: [{ id: 'notes', title: 'Notes', delivery: 'hosted', actionsAvailable: [] }],
            },
        },
    },
    {
        argv: ['apps', 'uninstalled'],
        replies: {
            dexto_apps_uninstalled_list: {
                apps: [{ appId: 'notes', title: 'Notes', dataDeletedOn: AT }],
            },
        },
    },
    {
        argv: ['applications', 'list'],
        replies: {
            dexto_applications_list: {
                applications: [{ id: ID, slug: 'api', status: 'ready', title: 'API' }],
                deployments: [
                    { id: ID, slug: 'api', status: 'live', createdAt: AT, endpointUrl: null },
                ],
            },
        },
    },
    {
        argv: ['autobots', 'list'],
        replies: {
            dexto_autobots_list: {
                autobots: [
                    { id: ID, profile: { name: 'Scout' }, updatedAt: AT, visibility: 'private' },
                ],
            },
        },
    },
    {
        argv: ['autobots', 'status'],
        replies: {
            dexto_autobot_status: {
                statuses: [
                    {
                        autobot: { id: ID, name: 'Scout' },
                        status: 'idle',
                        waitingOnUser: { text: 'Approve?', approvalId: ID },
                    },
                ],
                pagination: { nextCursor: 'c2' },
            },
        },
    },
    {
        argv: ['channels', 'list'],
        replies: {
            dexto_channels_list: {
                channels: [{ id: ID, title: 'general', visibility: 'org', unread: true }],
            },
        },
    },
    {
        argv: ['notifications', 'list'],
        replies: {
            dexto_notifications_list: {
                notifications: [
                    {
                        id: ID,
                        title: 'Done',
                        body: null,
                        kind: 'run',
                        source: 'loops',
                        severity: 'info',
                        createdAt: AT,
                        readAt: null,
                    },
                ],
                nextCursor: null,
            },
        },
    },
    {
        argv: ['chat', 'list'],
        replies: {
            dexto_chat_list: {
                sessions: [
                    {
                        id: CHAT,
                        title: 'Bug',
                        status: 'idle',
                        updatedAt: AT,
                        url: 'https://app.dexto.ai/c/1',
                        lastRun: { id: RUN, status: 'completed', finishedAt: AT },
                    },
                ],
                pagination: { nextCursor: 'c2' },
            },
        },
    },
    {
        argv: ['chat', 'models'],
        replies: {
            dexto_chat_models: {
                models: [{ id: 'm', name: 'M', current: true, routes: ['credits'] }],
            },
        },
    },
    {
        argv: ['chat', 'outputs', CHAT],
        replies: {
            dexto_chat_outputs_list: {
                outputs: [
                    {
                        id: ID,
                        kind: 'file',
                        name: 'a.txt',
                        reference: 'a.txt',
                        mimeType: 'text/plain',
                        sizeBytes: 3,
                        createdAt: AT,
                        url: null,
                    },
                ],
                nextCursor: 'c2',
            },
        },
    },
    {
        argv: ['chat', 'computers'],
        replies: {
            dexto_chat_computers_list: {
                computers: [
                    {
                        id: ID,
                        name: 'Mac',
                        platform: 'darwin',
                        presence: 'online',
                        compatible: true,
                        feature: { enabled: true },
                    },
                ],
            },
        },
    },
    {
        argv: ['chat', 'agents'],
        replies: {
            dexto_agents_list: {
                agents: [{ id: ID, name: 'Helper', description: null, isSystem: false }],
            },
        },
    },
    {
        argv: ['chat', 'browser-profiles'],
        replies: {
            dexto_chat_browser_profiles_list: {
                profiles: [{ id: ID, name: 'Work', available: true }],
            },
        },
    },
    {
        argv: ['projects', 'list'],
        replies: {
            dexto_projects_list: {
                projects: [
                    {
                        id: ID,
                        name: 'Launch',
                        description: null,
                        coordinator: {
                            conversationSessionId: null,
                            dailyChatCap: null,
                            startPolicy: 'start',
                        },
                        pinnedAt: null,
                        updatedAt: AT,
                    },
                ],
            },
        },
    },
    {
        argv: ['projects', 'recipes'],
        replies: {
            dexto_automation_recipes_list: {
                recipes: [
                    {
                        id: 'digest',
                        name: 'Digest',
                        description: 'Daily digest',
                        schedule: { cadence: 'daily', cronExpression: '0 9 * * *' },
                    },
                ],
            },
        },
    },
    {
        argv: ['workspace', 'tools'],
        replies: {
            'tools/list': {
                tools: [
                    {
                        name: 'dexto_search',
                        inputSchema: { type: 'object', properties: { maxResults: {} } },
                        _meta: { 'dexto/app': 'search' },
                    },
                ],
            },
        },
    },
    {
        argv: ['workspace', 'artifacts', 'list'],
        replies: {
            dexto_artifacts_list: {
                artifacts: [
                    {
                        artifactId: ID,
                        kind: 'plan',
                        preferredSurface: 'panel',
                        summary: 'A plan',
                        title: 'Plan',
                        updatedAt: AT,
                    },
                ],
                next: 'c2',
            },
        },
    },
    {
        argv: ['workspace', 'computers', 'keys', 'list'],
        replies: {
            dexto_computer_enrollment_keys_list: {
                keys: [
                    {
                        id: ID,
                        name: 'CI',
                        services: ['computer'],
                        enrolledComputers: 0,
                        maxComputers: 1,
                        expiresAt: AT,
                        status: 'active',
                    },
                ],
            },
        },
    },
    {
        argv: ['workspace', 'contacts', 'list'],
        replies: {
            dexto_contacts_people_list: {
                people: [
                    {
                        contactId: ID,
                        handle: 'ada',
                        name: 'Ada',
                        organization: null,
                        status: 'connected',
                        userId: ID,
                    },
                ],
            },
        },
    },
    {
        argv: ['workspace', 'contacts', 'search', 'ada'],
        replies: { dexto_contacts_people_search: { people: [PERSON] } },
    },
    {
        argv: ['workspace', 'contacts', 'requests'],
        replies: {
            dexto_contacts_requests_list: {
                requests: [{ ...PERSON, contactId: ID, direction: 'incoming' }],
            },
        },
    },
    {
        argv: ['workspace', 'network', 'list'],
        replies: {
            dexto_network_threads_list: {
                threads: [
                    {
                        lastActivityAt: AT,
                        person: { handle: 'ada', name: 'Ada', organization: null, userId: ID },
                        threadId: ID,
                        unread: true,
                    },
                ],
            },
        },
    },
    {
        argv: ['workspace', 'sites', 'records', 'list', SITE, 'signups'],
        replies: { dexto_site_records_list: { records: [RECORD] } },
    },
    {
        argv: ['workspace', 'share', 'received'],
        replies: {
            dexto_share_received: {
                invitations: [SHARED],
                shared: [{ ...SHARED, via: 'organization' }],
            },
        },
    },
    {
        argv: ['marketplace', 'search', 'notes'],
        replies: {
            dexto_marketplace_search: {
                listings: [
                    {
                        id: ID,
                        installsCount: 3,
                        kind: 'skill',
                        latestRelease: { releaseId: ID },
                        summary: 'Notes',
                        title: 'Notes',
                    },
                ],
            },
        },
    },
    {
        argv: ['docs', 'search', 'mcp'],
        replies: {
            dexto_docs_search: {
                results: [
                    { description: 'MCP', path: 'mcp', snippet: 'MCP', title: 'MCP', url: 'u' },
                ],
            },
        },
    },
    {
        argv: ['skills', 'versions', ID],
        replies: {
            dexto_skill_versions: {
                versions: [
                    { createdAt: AT, number: 1, savedBy: { displayName: 'Ada' }, versionId: ID },
                ],
            },
        },
    },
    {
        argv: ['connections', 'list'],
        replies: {
            dexto_connections_list: {
                connections: [
                    {
                        kind: 'model_connection',
                        name: 'openai',
                        id: ID,
                        provider: 'openai',
                        authType: 'oauth',
                        methodId: 'chatgpt_login',
                        label: null,
                        status: 'connected',
                        createdAt: AT,
                        updatedAt: AT,
                        lastTestedAt: null,
                        maskedIdentifier: null,
                        nextAction: null,
                    },
                ],
            },
        },
    },
    {
        argv: ['find', 'share a file'],
        replies: {
            'tools/list': { tools: [] },
            dexto_search: {
                results: [
                    {
                        title: 'Share',
                        summary: 'Share a file',
                        sourceKind: 'docs',
                        availability: 'available',
                        nextStep: 'Read it',
                    },
                ],
            },
        },
    },
    {
        argv: ['cloud', 'agents', 'list'],
        replies: {
            '/v1/agents': page([
                { id: 'agt_1', object: 'agent', name: 'A', model: null, version: 1, tools: [] },
            ]),
        },
    },
    {
        argv: ['cloud', 'agents', 'sessions', 'list', 'agt_1'],
        replies: {
            '/v1/agents/agt_1/sessions': page([{ id: 'ses_1', created_at: AT }], {
                has_more: true,
                next_after: 'ses_1',
            }),
        },
    },
    {
        argv: ['cloud', 'agents', 'messages', 'agt_1', 'ses_1'],
        replies: {
            '/v1/agents/agt_1/sessions/ses_1/messages': page([
                { id: 'msg_1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
            ]),
        },
    },
    {
        argv: ['cloud', 'agents', 'runs', 'list', 'agt_1', 'ses_1'],
        replies: {
            '/v1/agents/agt_1/sessions/ses_1/runs': page([{ id: 'run_1', status: 'completed' }]),
        },
    },
    {
        argv: ['cloud', 'agents', 'runs', 'steps', 'agt_1', 'ses_1', 'run_1'],
        replies: {
            '/v1/agents/agt_1/sessions/ses_1/runs/run_1/steps': page([
                { id: 'stp_1', type: 'tool_call', status: 'completed', error: null },
            ]),
        },
    },
    {
        argv: ['cloud', 'files', 'list'],
        replies: {
            '/v1/files': page([{ id: 'file_1', path: 'a.txt', size_bytes: 3 }], {
                has_more: true,
                next_after: 'file_1',
                next_cursor: 'file_1',
            }),
        },
    },
    {
        argv: ['cloud', 'secrets', 'list'],
        replies: { '/v1/secrets': page([{ id: 'sec_1', name: 'TOKEN' }]) },
    },
    {
        argv: ['cloud', 'automations', 'list'],
        replies: { '/v1/automations': page([{ id: 'aut_1', name: 'Nightly' }]) },
    },
    {
        argv: ['cloud', 'automations', 'firings', 'aut_1'],
        replies: {
            '/v1/automations/aut_1/firings': page([{ id: 'fir_1', status: 'succeeded' }]),
        },
    },
    {
        argv: ['cloud', 'sandboxes', 'list'],
        replies: { '/v1/sandboxes': page([{ id: 'sbx_1', name: 'dev', status: 'running' }]) },
    },
    {
        argv: ['cloud', 'sandboxes', 'ls', 'sbx_1'],
        replies: {
            '/v1/sandboxes/sbx_1/files/list': {
                data: [{ path: 'a.txt', is_directory: false, size: 3, modified_at: AT }],
                truncated: false,
            },
        },
    },
    {
        argv: ['cloud', 'sandboxes', 'import', 'sbx_1', 'file_1'],
        replies: {
            '/v1/sandboxes/sbx_1/files/import': {
                data: [{ path: 'a.txt', sandbox_path: '/workspace/a.txt', size_bytes: 3 }],
            },
        },
    },
    {
        argv: ['cloud', 'data-deletions', 'list'],
        replies: { '/v1/data_deletions': page([{ id: 'del_1', status: 'completed' }]) },
    },
    {
        argv: ['cloud', 'sites', 'list'],
        replies: {
            '/v1/sites': page([
                {
                    id: 'site_1',
                    slug: 'docs',
                    url: 'https://docs.dexto.site',
                    visibility: 'public',
                },
            ]),
        },
    },
    {
        argv: ['cloud', 'functions', 'list'],
        replies: {
            '/v1/functions': page([
                { id: 'fn_1', slug: 'hook', status: 'live', access: 'private', url: null },
            ]),
        },
    },
    {
        argv: ['cloud', 'models', 'list'],
        replies: {
            '/v1/models': page([
                {
                    id: 'gpt-5',
                    name: 'GPT-5',
                    capabilities: { maxInputTokens: 400_000, supportsToolCall: true },
                    pricing: { inputPerM: 1, outputPerM: 10, contextOver200kPerM: null },
                },
            ]),
            '/v1/media/models': page([
                {
                    id: 'flux',
                    media_kind: 'image',
                    pricing: { estimate_mode: 'fixed', unit: 'image' },
                },
            ]),
        },
    },
    {
        argv: ['cloud', 'models', 'runs', 'list'],
        replies: {
            '/v1/media/generations': page([{ id: 'gen_1', status: 'succeeded' }], {
                next_cursor: null,
            }),
        },
    },
    {
        argv: ['cloud', 'projects', 'list'],
        replies: {
            '/v1/projects': page([{ id: 'prj_1', name: 'Main', is_default: true }]),
        },
    },
    {
        argv: ['artifacts', 'list'],
        replies: {
            '/v1/artifacts': page([{ id: 'art_1', object: 'artifact', title: 'Report' }]),
        },
    },
    {
        argv: ['trace', 'list'],
        replies: { '/v1/traces': page([{ run_id: RUN, status: 'completed' }]) },
    },
    {
        argv: ['span', 'list', RUN],
        replies: { [`/v1/traces/${RUN}/spans`]: page([{ span_id: 's1', name: 'model' }]) },
    },
    {
        argv: ['models', 'list'],
        replies: {
            '/v1/models': page([{ id: 'gpt-5', name: 'GPT-5', context_window: 400_000 }]),
        },
    },
];

const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};
const COMMANDS = cloudCommands('/unused', unusedSignIn);

/** The words of the command `argv` runs: the longest registered path it starts with. */
function commandPath(argv: readonly string[]): string {
    const matches = COMMANDS.filter((command: Command) =>
        command.path.every((word, index) => argv[index] === word)
    ).map((command) => command.path.join(' '));
    const longest = matches.sort((a, b) => b.length - a.length)[0];
    if (longest === undefined) throw new Error(`No command runs ${argv.join(' ')}`);
    return longest;
}

/** Where a value has a camelCase key, outside data values (as `jsonKeys` leaves them). */
function camelCaseKeys(value: unknown, at = '$'): string[] {
    if (Array.isArray(value))
        return value.flatMap((each, index) => camelCaseKeys(each, `${at}[${index}]`));
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([key, field]: [string, unknown]) => {
        const where = `${at}.${key}`;
        const own = CAMEL_CASE.test(key) ? [where] : [];
        const data = DATA_KEYS.has(key) || (key === 'data' && !Array.isArray(field));
        return data ? own : [...own, ...camelCaseKeys(field, where)];
    });
}

describe('list commands print one JSON shape', () => {
    let dir: string;
    let replies: Record<string, unknown> = {};
    let stdout = '';
    let stderr = '';
    let host: CloudHost;

    /** The JSON-RPC reply to one MCP request: a tool's answer, or the tool list. */
    async function mcpReply(request: globalThis.Request): Promise<Response> {
        const message = await request.json();
        const key = message.method === 'tools/call' ? message.params.name : message.method;
        if (!(key in replies)) throw new Error(`Unexpected MCP call ${key}`);
        const value = replies[key];
        const result =
            message.method === 'tools/call' ? { content: [], structuredContent: value } : value;
        return Response.json({ jsonrpc: '2.0', id: message.id, result });
    }

    beforeAll(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-json-contract-')), 'accounts');
        await dextoAccounts.writeLogin(dir, 'default', {
            kind: 'oauth',
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            clientId: 'dexto-cli',
            appUrl: 'https://app.dexto.ai',
            apiBaseUrl: API,
            resource: MCP,
            tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
            scopes: SCOPES,
            savedAt: AT,
            signedInAs: null,
            cloudProject: null,
        });
        const runtime: CloudRuntime = {
            color: false,
            environment: {},
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url === MCP) return await mcpReply(request);
                const url = new URL(request.url);
                if (url.origin !== API || !url.pathname.startsWith('/v1/'))
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                if (!(url.pathname in replies)) throw new Error(`Unexpected ${url.pathname}`);
                return Response.json(replies[url.pathname]);
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
            signInForScopes: async () => false,
        };
    });

    afterAll(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    /** Runs a command with `--json` against these answers, and parses what it printed. */
    async function runJson(
        argv: readonly string[],
        answers: Record<string, unknown>
    ): Promise<unknown> {
        replies = answers;
        stdout = '';
        stderr = '';
        const code = await runCloud(host, [...argv, '--json']);
        expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
        return JSON.parse(stdout);
    }

    it('has a case for every list command', () => {
        const covered = new Set(CASES.map((each) => commandPath(each.argv)));
        const lists = COMMANDS.map((command) => command.path)
            .filter((words) => words.at(-1) === 'list')
            .map((words) => words.join(' '));
        const missing = [...lists, ...OTHER_LISTS].filter(
            (name) => !covered.has(name) && !SKIPPED.has(name)
        );
        expect(missing, `List commands without a case: ${missing.join(', ')}`).toEqual([]);
    });

    it.each(CASES.map((each) => ({ ...each, command: commandPath(each.argv) })))(
        '$command',
        async ({ argv, replies: answers }) => {
            const printed = await runJson(argv, answers);
            expect(printed).toMatchObject({
                data: expect.any(Array),
                has_more: expect.any(Boolean),
            });
            expect(printed).toHaveProperty('next_after');
            const nextAfter = isJsonObject(printed) ? printed.next_after : undefined;
            expect([null, 'string', 'number']).toContain(
                nextAfter === null ? null : typeof nextAfter
            );
            expect(printed).not.toHaveProperty('next_cursor');
            expect(printed).not.toHaveProperty('nextCursor');
            expect(camelCaseKeys(printed)).toEqual([]);
        }
    );

    it("keeps a record value's own keys and converts the record's", async () => {
        const printed = await runJson(['workspace', 'sites', 'records', 'list', SITE, 'signups'], {
            dexto_site_records_list: { records: [RECORD] },
        });
        expect(printed).toEqual({
            data: [{ id: ID, created_at: AT, updated_at: AT, value: { firstName: 'Ada' } }],
            has_more: false,
            next_after: null,
        });
    });
});
