import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const SKILL_ID = '11111111-1111-4111-8111-111111111111';
const LISTING_ID = '22222222-2222-4222-8222-222222222222';
const RELEASE_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const meta = (level: string) => ({ 'dexto/app': 'skills', 'dexto/level': level });
const CONFIRMED = { type: 'object', properties: { confirm: { type: 'boolean' } } };

const TOOLS = [
    { name: 'dexto_skill_get', inputSchema: { type: 'object' }, _meta: meta('read') },
    { name: 'dexto_skill_file_get', inputSchema: { type: 'object' }, _meta: meta('read') },
    { name: 'dexto_skill_validate', inputSchema: { type: 'object' }, _meta: meta('read') },
    { name: 'dexto_skill_create', inputSchema: { type: 'object' }, _meta: meta('act') },
    { name: 'dexto_skill_update', inputSchema: { type: 'object' }, _meta: meta('act') },
    { name: 'dexto_skill_delete', inputSchema: { type: 'object' }, _meta: meta('act') },
    { name: 'dexto_skill_install', inputSchema: CONFIRMED, _meta: meta('approve') },
    { name: 'dexto_skill_uninstall', inputSchema: CONFIRMED, _meta: meta('approve') },
    { name: 'dexto_skill_versions', inputSchema: { type: 'object' }, _meta: meta('read') },
    { name: 'dexto_skill_restore', inputSchema: { type: 'object' }, _meta: meta('act') },
    { name: 'dexto_skill_publish', inputSchema: CONFIRMED, _meta: meta('approve') },
];

const SKILL = {
    description: 'Writes in our voice.',
    instructions: '# Voice',
    location: { kind: 'library', skillId: SKILL_ID },
    manifest: { files: [{ path: 'SKILL.md' }, { path: 'references/style.md' }] },
    release: { digest: 'd1', id: RELEASE_ID, version: '2' },
    slug: 'voice',
    title: 'Voice',
};
const AUTHORED = { skill: { id: SKILL_ID, slug: 'voice', title: 'Voice' } };

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

type Answer = { isError: boolean; value: unknown };

describe('dexto skills library commands', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let host: CloudHost;

    const answer = (name: string, args: Record<string, unknown>): Answer => {
        const ok = (value: unknown): Answer => ({ isError: false, value });
        if (name === 'dexto_skill_get') return ok(SKILL);
        if (name === 'dexto_skill_file_get')
            return args.path === 'references/style.md'
                ? ok({
                      content: 'Be brief.',
                      file: { path: 'references/style.md', role: 'reference', sizeBytes: 9 },
                      location: args.location,
                      release: SKILL.release,
                  })
                : {
                      isError: true,
                      value: { status: 'not_found', message: 'Dexto Skill file was not found.' },
                  };
        if (name === 'dexto_skill_validate')
            return ok({ digest: 'd1', manifest: {}, status: 'valid' });
        if (name === 'dexto_skill_create') return ok({ ...AUTHORED, status: 'created' });
        if (name === 'dexto_skill_update') return ok({ ...AUTHORED, status: 'updated' });
        if (name === 'dexto_skill_versions')
            return ok({
                skillId: SKILL_ID,
                title: 'Voice',
                versions: [
                    {
                        createdAt: '2026-11-18T00:00:00.000Z',
                        number: 2,
                        savedBy: { displayName: 'Ada', handle: 'ada' },
                        version: '2',
                        versionId: VERSION_ID,
                    },
                ],
            });
        if (name === 'dexto_skill_restore')
            return ok({ skillId: SKILL_ID, status: 'restored', version: '3' });
        return ok({ status: 'ok' });
    };

    const writeLogin = async (scopes: string[]) =>
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

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-skill-library-')), 'accounts');
        stdout = '';
        stderr = '';
        calls = [];
        await writeLogin(['skills:read', 'skills:write']);
        const environment: Record<string, string> = {};
        const runtime: CloudRuntime = {
            color: false,
            environment,
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url.endsWith('/.well-known/oauth-protected-resource/mcp'))
                    return Response.json({ resource: MCP, dexto_app_scopes: {} });
                if (request.url !== MCP) return Response.json({}, { status: 404 });
                const message = JSON.parse(await request.text());
                if (message.method === 'tools/list')
                    return Response.json({
                        jsonrpc: '2.0',
                        id: message.id,
                        result: { tools: TOOLS },
                    });
                calls.push({ name: message.params.name, arguments: message.params.arguments });
                const answered = answer(message.params.name, message.params.arguments);
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(answered.value) }],
                        isError: answered.isError,
                        structuredContent: answered.value,
                    },
                });
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
            signInForScopes: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    /** A Skill folder with SKILL.md, a reference and an executable script. */
    const skillFolder = async (extra: Record<string, string | Uint8Array> = {}) => {
        const folder = path.join(path.dirname(dir), 'voice');
        await mkdir(path.join(folder, 'references'), { recursive: true });
        await mkdir(path.join(folder, 'scripts'), { recursive: true });
        await writeFile(
            path.join(folder, 'SKILL.md'),
            '---\nname: voice\ndescription: Writes in our voice.\n---\n# Voice\n'
        );
        await writeFile(path.join(folder, 'references', 'style.md'), 'Be brief.');
        await writeFile(path.join(folder, 'scripts', 'check.sh'), 'echo ok');
        await chmod(path.join(folder, 'scripts', 'check.sh'), 0o755);
        await writeFile(path.join(folder, '.hidden'), 'left out');
        for (const [name, content] of Object.entries(extra))
            await writeFile(path.join(folder, name), content);
        return folder;
    };

    const BUNDLE = {
        description: 'Writes in our voice.',
        files: [
            {
                content: '---\nname: voice\ndescription: Writes in our voice.\n---\n# Voice\n',
                path: 'SKILL.md',
                role: 'instructions',
            },
            { content: 'Be brief.', path: 'references/style.md', role: 'reference' },
            { content: 'echo ok', executable: true, path: 'scripts/check.sh', role: 'script' },
        ],
        slug: 'voice',
        title: 'Voice',
    };

    it.each([
        ['push', 'dexto skills push ./my-skill --yes --json'],
        ['sync', 'dexto skills sync --json'],
    ])('shows a JSON example for skills %s', async (command, example) => {
        expect(await runCloud(host, ['skills', command, '--help', '--json'])).toBe(0);
        expect(JSON.parse(stdout).examples).toContain(example);
    });

    it('names the missing skills scope for reads and writes, before any call', async () => {
        await writeLogin(['apps:read']);

        expect(await runCloud(host, ['skills', 'get', SKILL_ID, '--json'])).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('skills:read');
        stderr = '';
        expect(await runCloud(host, ['skills', 'delete', 'voice', '--yes', '--json'])).toBe(3);
        expect(JSON.parse(stderr).error.fix).toContain('skills:write');
        expect(calls).toEqual([]);
    });

    it('reads a library Skill by id, and a Store Skill by name or listing id', async () => {
        expect(await runCloud(host, ['skills', 'get', SKILL_ID, '--json'])).toBe(0);
        expect(JSON.parse(stdout)).toEqual(SKILL);
        expect(await runCloud(host, ['skills', 'get', '@dexto/voice', '--json'])).toBe(0);
        expect(await runCloud(host, ['skills', 'get', LISTING_ID, '--listing', '--json'])).toBe(0);

        expect(calls.map((call) => call.arguments)).toEqual([
            { location: { kind: 'library', skillId: SKILL_ID } },
            { location: { kind: 'marketplace', name: '@dexto/voice' } },
            { location: { kind: 'marketplace', listingId: LISTING_ID } },
        ]);
    });

    it("writes a declared file's text to --out, and reports a file the bundle does not declare as not found", async () => {
        const out = path.join(path.dirname(dir), 'style.md');

        expect(
            await runCloud(host, ['skills', 'file', SKILL_ID, 'references/style.md', '--out', out])
        ).toBe(0);
        expect(await readFile(out, 'utf8')).toBe('Be brief.');
        const shown = JSON.parse(stdout);
        expect(shown).toMatchObject({ contentPath: out, file: { path: 'references/style.md' } });
        expect(shown.content).toBeUndefined();

        expect(await runCloud(host, ['skills', 'file', SKILL_ID, '.env', '--json'])).toBe(5);
        expect(JSON.parse(stderr).error.code).toBe('not_found');
        expect(calls.map((call) => call.arguments)).toEqual([
            { location: { kind: 'library', skillId: SKILL_ID }, path: 'references/style.md' },
            { location: { kind: 'library', skillId: SKILL_ID }, path: '.env' },
        ]);
    });

    it('validates a folder as a complete bundle, each file with its role and executable bit', async () => {
        const folder = await skillFolder();

        expect(await runCloud(host, ['skills', 'validate', folder, '--json'])).toBe(0);

        expect(calls).toEqual([{ name: 'dexto_skill_validate', arguments: BUNDLE }]);
        expect(JSON.parse(stdout)).toMatchObject({ status: 'valid' });
    });

    it('refuses a folder with a file that is not UTF-8 text, before any call', async () => {
        const folder = await skillFolder({ 'logo.png': new Uint8Array([0xff, 0xfe, 0x00]) });

        expect(await runCloud(host, ['skills', 'validate', folder, '--json'])).toBe(2);
        expect(calls).toEqual([]);
    });

    it('creates only once agreed, and shows a dry run without the file text', async () => {
        const folder = await skillFolder();
        const args = ['skills', 'create', folder, '--title', 'Our Voice', '--json'];

        expect(await runCloud(host, args)).toBe(4);
        expect(JSON.parse(stderr).error.fix).toContain('--yes');
        expect(calls).toEqual([]);

        expect(await runCloud(host, [...args, '--dry-run'])).toBe(0);
        expect(calls).toEqual([]);
        expect(JSON.parse(stdout)).toEqual({
            dryRun: true,
            tool: 'dexto_skill_create',
            arguments: {
                description: 'Writes in our voice.',
                files: [
                    { bytes: 62, path: 'SKILL.md', role: 'instructions' },
                    { bytes: 9, path: 'references/style.md', role: 'reference' },
                    { bytes: 7, executable: true, path: 'scripts/check.sh', role: 'script' },
                ],
                slug: 'voice',
                title: 'Our Voice',
            },
        });
        stdout = '';

        expect(await runCloud(host, [...args, '--yes'])).toBe(0);
        expect(calls).toEqual([
            { name: 'dexto_skill_create', arguments: { ...BUNDLE, title: 'Our Voice' } },
        ]);
        expect(JSON.parse(stdout)).toMatchObject({ status: 'created', skill: { id: SKILL_ID } });
    });

    it('updates a Skill by id with the whole folder', async () => {
        const folder = await skillFolder();

        expect(await runCloud(host, ['skills', 'update', SKILL_ID, folder, '--yes'])).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_skill_update', arguments: { skillId: SKILL_ID, ...BUNDLE } },
        ]);
    });

    it('deletes and uninstalls a library Skill by id or by slug', async () => {
        expect(await runCloud(host, ['skills', 'delete', 'voice', '--yes'])).toBe(0);
        expect(await runCloud(host, ['skills', 'delete', SKILL_ID, '--yes'])).toBe(0);
        expect(await runCloud(host, ['skills', 'uninstall', 'voice', '--yes'])).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_skill_delete', arguments: { slug: 'voice' } },
            { name: 'dexto_skill_delete', arguments: { skillId: SKILL_ID } },
            { name: 'dexto_skill_uninstall', arguments: { slug: 'voice', confirm: true } },
        ]);
    });

    it('installs a Store Skill by name or listing id, or a library Skill, passing confirm once agreed', async () => {
        expect(await runCloud(host, ['skills', 'install', '@dexto/voice', '--json'])).toBe(4);
        expect(calls).toEqual([]);

        expect(await runCloud(host, ['skills', 'install', '@dexto/voice', '--yes'])).toBe(0);
        expect(await runCloud(host, ['skills', 'install', LISTING_ID, '--listing', '--yes'])).toBe(
            0
        );
        expect(await runCloud(host, ['skills', 'install', SKILL_ID, '--yes'])).toBe(0);
        expect(await runCloud(host, ['skills', 'install', 'voice', '--yes'])).toBe(0);

        expect(calls.map((call) => call.arguments)).toEqual([
            { name: '@dexto/voice', confirm: true },
            { listingId: LISTING_ID, confirm: true },
            { skillId: SKILL_ID, confirm: true },
            { slug: 'voice', confirm: true },
        ]);
    });

    it('lists versions and restores one', async () => {
        expect(await runCloud(host, ['skills', 'versions', SKILL_ID, '--json'])).toBe(0);
        expect(JSON.parse(stdout).data[0]).toMatchObject({ number: 2, versionId: VERSION_ID });
        stdout = '';

        expect(await runCloud(host, ['skills', 'restore', SKILL_ID, VERSION_ID, '--json'])).toBe(4);
        expect(
            await runCloud(host, ['skills', 'restore', SKILL_ID, VERSION_ID, '--yes', '--json'])
        ).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ status: 'restored', version: '3' });

        expect(calls).toEqual([
            { name: 'dexto_skill_versions', arguments: { skillId: SKILL_ID } },
            {
                name: 'dexto_skill_restore',
                arguments: { skillId: SKILL_ID, versionId: VERSION_ID },
            },
        ]);
    });

    it("publishes the latest release under the Skill's title by default", async () => {
        const args = [
            'skills',
            'publish',
            SKILL_ID,
            '--summary',
            'Writes in our voice.',
            '--category',
            'writing',
            '--keyword',
            'voice',
            '--keyword',
            'brand',
            '--yes',
        ];

        expect(await runCloud(host, args)).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_skill_get',
                arguments: { location: { kind: 'library', skillId: SKILL_ID } },
            },
            {
                name: 'dexto_skill_publish',
                arguments: {
                    category: 'writing',
                    confirm: true,
                    keywords: ['voice', 'brand'],
                    releaseId: RELEASE_ID,
                    skillId: SKILL_ID,
                    summary: 'Writes in our voice.',
                    title: 'Voice',
                },
            },
        ]);
    });

    it('publishes a given release and title without reading the Skill, and checks the category', async () => {
        expect(
            await runCloud(host, [
                'skills',
                'publish',
                SKILL_ID,
                '--summary',
                'S.',
                '--category',
                'games',
            ])
        ).toBe(2);
        await writeLogin(['skills:write']);

        expect(
            await runCloud(host, [
                'skills',
                'publish',
                SKILL_ID,
                '--summary',
                'S.',
                '--title',
                'Voice 2',
                '--release',
                RELEASE_ID,
                '--dry-run',
            ])
        ).toBe(0);

        expect(calls).toEqual([]);
        expect(JSON.parse(stdout).arguments).toEqual({
            releaseId: RELEASE_ID,
            skillId: SKILL_ID,
            summary: 'S.',
            title: 'Voice 2',
        });
    });
});
