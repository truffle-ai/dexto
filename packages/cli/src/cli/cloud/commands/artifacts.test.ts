import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const meta = (level: string) => ({ 'dexto/app': 'artifacts', 'dexto/level': level });

const TOOLS = [
    { name: 'dexto_artifacts_list', inputSchema: { type: 'object' }, _meta: meta('read') },
    { name: 'dexto_artifacts_get', inputSchema: { type: 'object' }, _meta: meta('read') },
    { name: 'dexto_artifacts_create', inputSchema: { type: 'object' }, _meta: meta('act') },
    { name: 'dexto_artifacts_replace', inputSchema: { type: 'object' }, _meta: meta('act') },
    {
        name: 'dexto_artifacts_share',
        inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
        _meta: meta('approve'),
    },
];

const SAVED = {
    artifactId: 'a1',
    html: '<h1>Old</h1>',
    kind: 'plan',
    preferredSurface: 'fullscreen',
    renderer: 'html',
    summary: 'The plan.',
    title: 'Plan',
    updatedAt: '2026-11-04T00:00:00.000Z',
};

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto workspace artifacts', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let stdin: string;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let host: CloudHost;

    const answer = (name: string, args: Record<string, unknown>): unknown => {
        if (name === 'dexto_artifacts_list')
            return {
                action: 'artifacts.list',
                artifacts: [SAVED].map(({ html: _h, renderer: _r, ...rest }) => rest),
                next: 'c2',
            };
        if (name === 'dexto_artifacts_get')
            return { action: 'artifacts.get', artifact: args.artifactId === 'a1' ? SAVED : null };
        if (name === 'dexto_artifacts_share')
            return {
                ...args,
                url: args.visibility === 'link-shared' ? 'https://app.dexto.ai/s/a1' : null,
            };
        const reference = { artifactId: 'a1', title: String(args.title) };
        return { action: name.replace('dexto_artifacts_', 'artifacts.'), artifact: reference };
    };

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-artifacts-')), 'accounts');
        stdout = '';
        stderr = '';
        stdin = '';
        calls = [];
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
            scopes: ['apps:read', 'apps:execute'],
            savedAt: '2026-11-01T00:00:00.000Z',
            signedInAs: null,
            cloudProject: null,
        });
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
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [{ type: 'text', text: 'ok' }],
                        structuredContent: answer(message.params.name, message.params.arguments),
                    },
                });
            },
            prompt: null,
            readStdin: async () => stdin,
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

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    const htmlFile = async (name: string, html: string) => {
        const file = path.join(path.dirname(dir), name);
        await writeFile(file, html);
        return file;
    };

    it('lists Artifacts as a page whose cursor is the next --after', async () => {
        expect(
            await runCloud(host, [
                'workspace',
                'artifacts',
                'list',
                '--limit',
                '5',
                '--after',
                'c1',
            ])
        ).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_artifacts_list', arguments: { cursor: 'c1', limit: 5 } },
        ]);
        const page = JSON.parse(stdout);
        expect(page).toMatchObject({ has_more: true, next_after: 'c2' });
        expect(page.data[0].artifactId).toBe('a1');
    });

    it('passes --chat and paging to the Artifact MCP tool in JSON mode', async () => {
        expect(
            await runCloud(host, [
                'workspace',
                'artifacts',
                'list',
                '--chat',
                'chat-a',
                '--limit',
                '5',
                '--after',
                'c1',
                '--json',
            ])
        ).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_artifacts_list',
                arguments: { sessionId: 'chat-a', cursor: 'c1', limit: 5 },
            },
        ]);
        expect(JSON.parse(stdout)).toMatchObject({
            data: [{ artifactId: 'a1' }],
            next_after: 'c2',
        });
    });

    it("writes an Artifact's HTML to --out and shows the rest", async () => {
        const out = path.join(path.dirname(dir), 'plan.html');

        expect(await runCloud(host, ['workspace', 'artifacts', 'get', 'a1', '--out', out])).toBe(0);

        expect(await readFile(out, 'utf8')).toBe('<h1>Old</h1>');
        const shown = JSON.parse(stdout);
        expect(shown).toMatchObject({ artifactId: 'a1', htmlPath: out });
        expect(shown.html).toBeUndefined();
    });

    it('exits 5 for an Artifact that is not there', async () => {
        expect(await runCloud(host, ['workspace', 'artifacts', 'get', 'nope'])).toBe(5);
        expect(JSON.parse(stderr).error.code).toBe('not_found');
    });

    it('creates from a file once agreed, named after it, with the idempotency key', async () => {
        const file = await htmlFile('report.html', '<h1>Report</h1>');
        const args = ['workspace', 'artifacts', 'create', file, '--idempotency-key', 'k1'];

        expect(await runCloud(host, args)).toBe(4);
        expect(calls).toHaveLength(0);

        expect(await runCloud(host, [...args, '--yes'])).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_artifacts_create',
                arguments: {
                    html: '<h1>Report</h1>',
                    idempotencyKey: 'k1',
                    kind: 'document',
                    preferredSurface: 'panel',
                    renderer: 'html',
                    summary: '',
                    title: 'report',
                },
            },
        ]);
        expect(JSON.parse(stdout)).toMatchObject({
            artifact: { artifactId: 'a1' },
        });
    });

    it('needs --title for HTML on stdin', async () => {
        stdin = '<p>piped</p>';

        expect(await runCloud(host, ['workspace', 'artifacts', 'create', '-', '--yes'])).toBe(2);
        expect(
            await runCloud(host, [
                'workspace',
                'artifacts',
                'create',
                '-',
                '--title',
                'Piped',
                '--yes',
            ])
        ).toBe(0);
        expect(calls.at(-1)?.arguments).toMatchObject({ html: '<p>piped</p>', title: 'Piped' });
    });

    it('shows a dry run without calling, the HTML by size', async () => {
        const file = await htmlFile('deck.html', '<section>1</section>');

        const code = await runCloud(host, [
            'workspace',
            'artifacts',
            'create',
            file,
            '--kind',
            'slide-deck',
            '--renderer',
            'reveal',
            '--dry-run',
        ]);

        expect(code).toBe(0);
        expect(calls).toHaveLength(0);
        expect(JSON.parse(stdout)).toEqual({
            dryRun: true,
            tool: 'dexto_artifacts_create',
            arguments: {
                htmlBytes: 20,
                kind: 'slide-deck',
                preferredSurface: 'panel',
                renderer: 'reveal',
                summary: '',
                title: 'deck',
            },
        });
    });

    it('refuses a reveal renderer for anything but a slide-deck, and HTML too large', async () => {
        const file = await htmlFile('a.html', '<p>a</p>');
        expect(
            await runCloud(host, ['workspace', 'artifacts', 'create', file, '--renderer', 'reveal'])
        ).toBe(2);
        const large = await htmlFile('large.html', 'x'.repeat(524_289));
        expect(await runCloud(host, ['workspace', 'artifacts', 'create', large, '--yes'])).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it('replaces the HTML, keeping what it does not change', async () => {
        const file = await htmlFile('new.html', '<h1>New</h1>');

        const code = await runCloud(host, [
            'workspace',
            'artifacts',
            'replace',
            'a1',
            file,
            '--summary',
            'Revised.',
            '--yes',
        ]);

        expect(code).toBe(0);
        expect(calls.at(-1)).toEqual({
            name: 'dexto_artifacts_replace',
            arguments: {
                artifactId: 'a1',
                html: '<h1>New</h1>',
                kind: 'plan',
                preferredSurface: 'fullscreen',
                renderer: 'html',
                summary: 'Revised.',
                title: 'Plan',
            },
        });
    });

    it('shares by link once agreed, passing confirm', async () => {
        const args = ['workspace', 'artifacts', 'share', 'a1', '--visibility', 'link-shared'];

        expect(await runCloud(host, args)).toBe(4);
        expect(JSON.parse(stderr).error.fix).toContain('--yes');
        expect(calls).toHaveLength(0);

        expect(await runCloud(host, [...args, '--yes', '--table'])).toBe(0);
        expect(calls).toEqual([
            {
                name: 'dexto_artifacts_share',
                arguments: { artifactId: 'a1', visibility: 'link-shared', confirm: true },
            },
        ]);
        expect(stdout).toContain('Artifact a1 is now link-shared: https://app.dexto.ai/s/a1');
    });

    it('refuses a visibility it does not know', async () => {
        expect(
            await runCloud(host, [
                'workspace',
                'artifacts',
                'share',
                'a1',
                '--visibility',
                'public',
            ])
        ).toBe(2);
    });
});
