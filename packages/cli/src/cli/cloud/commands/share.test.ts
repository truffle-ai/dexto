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
const unusedSignIn = async (): Promise<never> => {
    throw new Error('No sign-ins in tests');
};

const access = {
    access: 'people',
    organization: null,
    people: [
        {
            avatarUrl: null,
            email: 'ana@example.com',
            name: 'Ana',
            role: 'viewer',
            since: '2026-11-20T00:00:00.000Z',
            userId: '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
        },
    ],
    public: null,
    title: 'Roadmap.md',
};

const received = {
    invitations: [],
    shared: [
        {
            target: { kind: 'drive', id: 'file-2' },
            title: 'Q4 plan',
            path: '/drive/file-2',
            url: 'https://app.dexto.ai/drive/file-2',
            owner: { displayName: 'Ana', handle: 'ana' },
            resourceId: 'resource-2',
            via: 'organization',
        },
        {
            target: { kind: 'skill', id: 'skill-1' },
            title: 'Release notes',
            path: '/skills/skill-1',
            url: 'https://app.dexto.ai/skills/skill-1',
            owner: { displayName: 'Bo', handle: null },
            resourceId: 'resource-1',
            via: 'person',
        },
    ],
};

/** One MCP answer: the tool's structured result, or a JSON-RPC refusal. */
type Reply = { result: unknown } | { error: { code: number; message: string; data?: unknown } };

describe('sharing reads over the Dexto MCP', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: unknown }[];
    let replies: Reply[];
    let terminal: boolean;
    let host: CloudHost;

    async function cli(...args: string[]): Promise<number> {
        return await runCloud(host, args);
    }

    const output = () => JSON.parse(stdout);

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-share-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        replies = [];
        terminal = false;
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
            scopes: ['drive:read'],
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
                const reply = replies.shift();
                if (reply === undefined) throw new Error('Unexpected MCP call');
                return Response.json(
                    'error' in reply
                        ? { jsonrpc: '2.0', id: message.id, error: reply.error }
                        : {
                              jsonrpc: '2.0',
                              id: message.id,
                              result: { content: [], structuredContent: reply.result },
                          }
                );
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
            signInForScopes: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('shares a Project with the organization after explicit consent', async () => {
        const result = { created: true, organizationId: 'org-1', title: 'Plan' };
        replies = [{ result }];
        expect(
            await cli(
                'workspace',
                'share',
                'organization',
                'project',
                'project-1',
                '--role',
                'editor',
                '--yes',
                '--json'
            ),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_share',
                arguments: {
                    action: 'organization',
                    kind: 'project',
                    id: 'project-1',
                    role: 'editor',
                    confirm: true,
                },
            },
        ]);
        expect(output()).toEqual(result);
    });

    it('shares an App record with multiple people with the requested role and notification setting', async () => {
        const result = {
            added: ['5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c', '6c1f8d9b-2e3f-4a4b-8c5d-6e7f8a9b0c1d'],
            title: 'Artifact',
        };
        replies = [{ result }];
        expect(
            await cli(
                'workspace',
                'share',
                'people',
                'app',
                'artifact-1',
                '--app',
                'artifacts',
                '--collection',
                'artifacts',
                '--user-id',
                '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                '--user-id',
                '6c1f8d9b-2e3f-4a4b-8c5d-6e7f8a9b0c1d',
                '--role',
                'viewer',
                '--no-notify',
                '--yes',
                '--json'
            ),
            stderr
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_share',
                arguments: {
                    action: 'people',
                    kind: 'app',
                    id: 'artifact-1',
                    app: 'artifacts',
                    collection: 'artifacts',
                    userIds: [
                        '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                        '6c1f8d9b-2e3f-4a4b-8c5d-6e7f8a9b0c1d',
                    ],
                    role: 'viewer',
                    notify: false,
                    confirm: true,
                },
            },
        ]);
        expect(output()).toEqual(result);
    });

    it('passes editor access for a chat shared with a person', async () => {
        replies = [{ result: { added: ['5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c'], title: 'Chat' } }];
        expect(
            await cli(
                'workspace',
                'share',
                'people',
                'chat',
                'chat-1',
                '--user-id',
                '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                '--role',
                'editor',
                '--yes',
                '--json'
            ),
            stderr
        ).toBe(0);
        expect(calls[0]?.arguments).toEqual({
            action: 'people',
            kind: 'chat',
            id: 'chat-1',
            userIds: ['5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c'],
            role: 'editor',
            confirm: true,
        });
    });

    it('revokes organization and person access as act calls without an approval field', async () => {
        replies = [
            { result: { organizationId: 'org-1' } },
            { result: { userId: '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c' } },
        ];
        expect(
            await cli(
                'workspace',
                'share',
                'unshare-organization',
                'drive',
                'file-1',
                '--yes',
                '--json'
            ),
            stderr
        ).toBe(0);
        expect(output()).toEqual({ organizationId: 'org-1' });
        stdout = '';
        expect(
            await cli(
                'workspace',
                'share',
                'unshare-person',
                'chat',
                'chat-1',
                '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                '--yes',
                '--json'
            ),
            stderr
        ).toBe(0);
        expect(output()).toEqual({ userId: '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c' });
        expect(calls).toEqual([
            {
                name: 'dexto_share',
                arguments: { action: 'unshare_organization', kind: 'drive', id: 'file-1' },
            },
            {
                name: 'dexto_share',
                arguments: {
                    action: 'unshare_person',
                    kind: 'chat',
                    id: 'chat-1',
                    userId: '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                },
            },
        ]);
    });

    it('shows a dry run without consent or an MCP call', async () => {
        expect(
            await cli(
                'workspace',
                'share',
                'people',
                'project',
                'project-1',
                '--user-id',
                '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                '--dry-run',
                '--json'
            ),
            stderr
        ).toBe(0);
        expect(output()).toEqual({
            dryRun: true,
            tool: 'dexto_share',
            arguments: {
                action: 'people',
                kind: 'project',
                id: 'project-1',
                userIds: ['5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c'],
            },
        });
        expect(calls).toEqual([]);
    });

    it('requires consent for grants and act-level revocations in a headless session', async () => {
        for (const args of [
            ['organization', 'drive', 'file-1'],
            ['people', 'drive', 'file-1', '--user-id', '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c'],
            ['unshare-organization', 'drive', 'file-1'],
            ['unshare-person', 'drive', 'file-1', '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c'],
        ]) {
            stderr = '';
            expect(await cli('workspace', 'share', ...args, '--json')).toBe(4);
            expect(stderr).toContain('--yes');
        }
        expect(calls).toEqual([]);
    });

    it('passes every sharing kind and leaves target and role restrictions to the server', async () => {
        const kinds = ['app', 'drive', 'skill', 'project', 'loop', 'chat', 'site'];
        for (const kind of kinds) {
            replies = [{ result: { added: [], title: 'Thing' } }];
            expect(
                await cli(
                    'workspace',
                    'share',
                    'people',
                    kind,
                    'thing-1',
                    '--user-id',
                    '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                    '--role',
                    'viewer',
                    '--yes',
                    '--json'
                ),
                stderr
            ).toBe(0);
        }
        expect(calls.map((call) => call.arguments)).toEqual(
            kinds.map((kind) => ({
                action: 'people',
                kind,
                id: 'thing-1',
                userIds: ['5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c'],
                role: 'viewer',
                confirm: true,
            }))
        );
    });

    it('passes organization role, app target and notification choices', async () => {
        replies = [{ result: { created: true, organizationId: 'org-1', title: 'Thing' } }];
        expect(
            await cli(
                'workspace',
                'share',
                'organization',
                'app',
                'record-1',
                '--app',
                'artifacts',
                '--collection',
                'artifacts',
                '--role',
                'viewer',
                '--no-notify',
                '--yes',
                '--json'
            ),
            stderr
        ).toBe(0);
        expect(calls[0]?.arguments).toEqual({
            action: 'organization',
            kind: 'app',
            id: 'record-1',
            app: 'artifacts',
            collection: 'artifacts',
            role: 'viewer',
            notify: false,
            confirm: true,
        });
    });

    it('rejects missing recipients and unknown roles before making a call', async () => {
        expect(
            await cli('workspace', 'share', 'people', 'drive', 'file-1', '--yes', '--json')
        ).toBe(2);
        expect(stderr).toContain('--user-id');
        expect(
            await cli(
                'workspace',
                'share',
                'organization',
                'drive',
                'file-1',
                '--role',
                'admin',
                '--yes',
                '--json'
            )
        ).toBe(2);
        expect(calls).toEqual([]);
    });

    it('preserves server refusal messages and missing-scope guidance', async () => {
        replies = [
            {
                error: {
                    code: -32003,
                    message: 'Missing required scope: projects:write',
                    data: { kind: 'forbidden', scope: 'projects:write' },
                },
            },
        ];
        expect(
            await cli(
                'workspace',
                'share',
                'organization',
                'project',
                'project-1',
                '--yes',
                '--json'
            )
        ).toBe(3);
        expect(stderr).toContain('projects:write');
        expect(stderr).toContain('--scope projects:write');
        stderr = '';
        replies = [
            {
                error: {
                    code: -32004,
                    message: 'It is not shared with that person.',
                    data: { kind: 'not_found' },
                },
            },
        ];
        expect(
            await cli(
                'workspace',
                'share',
                'unshare-person',
                'drive',
                'file-1',
                '5b0e7c8a-1d2e-4f3a-9b4c-5d6e7f8a9b0c',
                '--yes',
                '--json'
            )
        ).toBe(5);
        expect(stderr).toContain('It is not shared with that person.');
        stderr = '';
        replies = [
            {
                error: {
                    code: -32602,
                    message: 'Only a Project can be shared for editing.',
                    data: { kind: 'invalid_arguments' },
                },
            },
        ];
        expect(
            await cli(
                'workspace',
                'share',
                'organization',
                'drive',
                'file-1',
                '--role',
                'editor',
                '--yes',
                '--json'
            )
        ).toBe(2);
        expect(stderr).toContain('Only a Project can be shared for editing.');
    });

    describe('workspace share access', () => {
        it('reads who can open a Drive item and prints the server answer as JSON', async () => {
            replies = [{ result: access }];
            expect(
                await cli('workspace', 'share', 'access', 'drive', 'file-1', '--json'),
                stderr
            ).toBe(0);
            expect(calls).toEqual([
                { name: 'dexto_share_access', arguments: { kind: 'drive', id: 'file-1' } },
            ]);
            expect(output()).toEqual(access);
        });

        it('passes the App and collection for an App record', async () => {
            replies = [{ result: { ...access, access: 'only_me', people: [] } }];
            expect(
                await cli(
                    'workspace',
                    'share',
                    'access',
                    'app',
                    'artifact-1',
                    '--app',
                    'artifacts',
                    '--collection',
                    'artifacts',
                    '--json'
                ),
                stderr
            ).toBe(0);
            expect(calls).toEqual([
                {
                    name: 'dexto_share_access',
                    arguments: {
                        kind: 'app',
                        id: 'artifact-1',
                        app: 'artifacts',
                        collection: 'artifacts',
                    },
                },
            ]);
        });

        it('takes every kind Sharing names', async () => {
            for (const kind of ['app', 'drive', 'skill', 'project', 'loop', 'chat', 'site']) {
                replies = [{ result: access }];
                expect(
                    await cli('workspace', 'share', 'access', kind, 'thing-1', '--json'),
                    stderr
                ).toBe(0);
            }
            expect(calls.map((call) => call.arguments)).toEqual(
                ['app', 'drive', 'skill', 'project', 'loop', 'chat', 'site'].map((kind) => ({
                    kind,
                    id: 'thing-1',
                }))
            );
        });

        it('refuses an unknown kind or a missing id before calling', async () => {
            expect(await cli('workspace', 'share', 'access', 'page', 'page-1', '--json')).toBe(2);
            expect(stderr).toContain('app, drive, skill, project, loop, chat or site');
            expect(await cli('workspace', 'share', 'access', 'drive', '--json')).toBe(2);
            expect(calls).toEqual([]);
        });

        it('says what the person can see in text', async () => {
            terminal = true;
            replies = [
                {
                    result: {
                        ...access,
                        access: 'public',
                        organization: {
                            organizationId: 'org-1',
                            role: 'editor',
                            since: '2026-11-19T00:00:00.000Z',
                        },
                        public: {
                            kind: 'link',
                            since: '2026-11-21T00:00:00.000Z',
                            url: 'https://app.dexto.ai/p/abc',
                        },
                    },
                },
            ];
            expect(await cli('workspace', 'share', 'access', 'drive', 'file-1'), stderr).toBe(0);
            expect(stdout).toContain('Roadmap.md: public');
            expect(stdout).toContain('Organization: editor');
            expect(stdout).toContain('Ana <ana@example.com> viewer');
            expect(stdout).toContain('Public link: https://app.dexto.ai/p/abc');
        });

        it('reports something the person cannot open as not found', async () => {
            replies = [
                {
                    error: {
                        code: -32004,
                        message: 'Drive item not found.',
                        data: { kind: 'not_found' },
                    },
                },
            ];
            expect(
                await cli('workspace', 'share', 'access', 'drive', 'someone-elses', '--json')
            ).toBe(5);
            expect(stderr).toContain('Drive item not found.');
            expect(calls.map((call) => call.name)).toEqual(['dexto_share_access']);
        });

        it('asks to sign in again when the kind needs a permission the sign-in lacks', async () => {
            replies = [
                {
                    error: {
                        code: -32003,
                        message: 'Missing required scope: skills:read',
                        data: { kind: 'forbidden', scope: 'skills:read' },
                    },
                },
            ];
            expect(await cli('workspace', 'share', 'access', 'skill', 'skill-1', '--json')).toBe(3);
            expect(stderr).toContain('--scope skills:read');
            expect(calls.map((call) => call.name)).toEqual(['dexto_share_access']);
        });
    });

    describe('workspace share received', () => {
        it('lists every readable kind, newest first as the server orders it', async () => {
            replies = [{ result: received }];
            expect(await cli('workspace', 'share', 'received', '--json'), stderr).toBe(0);
            expect(calls).toEqual([{ name: 'dexto_share_received', arguments: {} }]);
            expect(output()).toEqual(received);
        });

        it('narrows to one kind', async () => {
            replies = [{ result: { invitations: [], shared: [received.shared[0]] } }];
            expect(
                await cli('workspace', 'share', 'received', '--kind', 'drive', '--json'),
                stderr
            ).toBe(0);
            expect(calls).toEqual([{ name: 'dexto_share_received', arguments: { kind: 'drive' } }]);
        });

        it('narrows to Sites', async () => {
            replies = [{ result: { invitations: [], shared: [] } }];
            expect(
                await cli('workspace', 'share', 'received', '--kind', 'site', '--json'),
                stderr
            ).toBe(0);
            expect(calls).toEqual([{ name: 'dexto_share_received', arguments: { kind: 'site' } }]);
        });

        it('refuses an unknown kind before calling', async () => {
            expect(await cli('workspace', 'share', 'received', '--kind', 'page', '--json')).toBe(2);
            expect(calls).toEqual([]);
        });

        it('asks to sign in again when the sign-in reads none of the shared kinds', async () => {
            replies = [
                {
                    error: {
                        code: -32003,
                        message: 'This needs one of these permissions.',
                        data: { kind: 'forbidden', scopes: ['apps:read', 'drive:read'] },
                    },
                },
            ];
            expect(await cli('workspace', 'share', 'received', '--json')).toBe(3);
            expect(stderr).toContain('--scope apps:read');
            expect(calls.map((call) => call.name)).toEqual(['dexto_share_received']);
        });

        it('prints shared items and invitations in server order', async () => {
            terminal = true;
            replies = [
                {
                    result: {
                        ...received,
                        invitations: [
                            {
                                ...received.shared[1],
                                title: 'Launch board',
                                invitationId: 'invite-1',
                            },
                        ],
                    },
                },
            ];
            expect(await cli('workspace', 'share', 'received'), stderr).toBe(0);
            expect(stdout.indexOf('Q4 plan')).toBeLessThan(stdout.indexOf('Release notes'));
            expect(stdout).toContain('drive  Q4 plan  Ana (@ana)  organization');
            expect(stdout).toContain('https://app.dexto.ai/skills/skill-1');
            expect(stdout).toContain('Invitations');
            expect(stdout).toContain('Launch board');
        });

        it('says when nothing is shared', async () => {
            terminal = true;
            replies = [{ result: { invitations: [], shared: [] } }];
            expect(await cli('workspace', 'share', 'received'), stderr).toBe(0);
            expect(stdout).toContain('Nothing is shared with you.');
        });
    });
});
