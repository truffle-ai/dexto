import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dextoAccounts } from '@dexto/agent-management';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import { nodeCloudRuntime } from '../runtime.js';
import { resolveConnection } from '../connection.js';
import { zipArchive } from '../zip.js';
import type { CloudRuntime } from '../runtime.js';
import { z } from 'zod';
import { claudeSession } from '../../import/test-utils.js';

const temporary: string[] = [];
afterEach(async () => {
    for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-export-'));
    temporary.push(dir);
    const archive = path.join(dir, 'export.zip');
    const files = await Promise.all(
        ['conversations.json', 'projects.json'].map(async (name) => ({
            path: `fixture-account/${name}`,
            bytes: await readFile(
                new URL(`../../import/fixtures/claude-export/${name}`, import.meta.url)
            ),
        }))
    );
    await writeFile(archive, zipArchive(files));
    let stdout = '';
    let stderr = '';
    const calls: { name: string; arguments: Record<string, unknown> }[] = [];
    const runtime: CloudRuntime = {
        ...nodeCloudRuntime(new AbortController().signal),
        environment: {},
        homeDirectory: dir,
        prompt: null,
        stdoutIsTerminal: false,
        writeOutput: (text: string) => {
            stdout += text;
        },
        writeError: (text: string) => {
            stderr += text;
        },
        fetch: async (): Promise<Response> => {
            throw new Error('Dry run must not authenticate or send requests');
        },
    };
    const signIn = async (): Promise<never> => {
        throw new Error('No sign-in in tests');
    };
    const host: CloudHost = {
        commands: cloudCommands(dir, signIn),
        groups: CLOUD_GROUPS,
        runtime,
        signIn,
        signInForScope: async () => false,
        resolveConnection: (overrides) =>
            resolveConnection({
                dir,
                environment: runtime.environment,
                overrides,
                refresh: async (login: dextoAccounts.OAuthLogin) => login,
            }),
    };
    return {
        dir,
        archive,
        host,
        runtime,
        calls,
        reset: () => {
            stdout = '';
            stderr = '';
        },
        stdout: () => stdout,
        stderr: () => stderr,
    };
}

async function signInFixture(dir: string) {
    const mcp = 'https://app.dexto.ai/mcp';
    await dextoAccounts.writeLogin(dir, 'default', {
        kind: 'oauth',
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: 'https://app.dexto.ai',
        apiBaseUrl: 'https://api.dexto.ai',
        resource: mcp,
        tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        scopes: ['sessions:write', 'projects:write', 'projects:read', 'drive:write', 'drive:read'],
        savedAt: '2026-11-01T00:00:00Z',
        signedInAs: null,
        cloudProject: null,
    });
}

it('previews a real-shape Claude export as redacted chats and Project files without authentication', async () => {
    const h = await fixture();
    const code = await runCloud(h.host, [
        'chat',
        'import',
        '--from',
        'claude-export',
        h.archive,
        '--dry-run',
        '--json',
    ]);
    expect(code, h.stderr()).toBe(0);
    const preview = JSON.parse(h.stdout());
    expect(preview.sessions).toEqual([
        expect.objectContaining({
            id: '10000000-0000-4000-8000-000000000001',
            status: 'ready',
            input: expect.objectContaining({
                source: 'claude-export',
                messages: [
                    expect.objectContaining({
                        role: 'user',
                        text: 'Plan a release. password=[redacted:assignment]',
                    }),
                    expect.objectContaining({
                        role: 'assistant',
                        text: 'Start with the release checklist.',
                    }),
                ],
            }),
        }),
    ]);
    expect(preview.projects).toEqual([
        expect.objectContaining({
            sourceId: '20000000-0000-4000-8000-000000000001',
            files: [
                expect.objectContaining({
                    name: '50000000-0000-4000-8000-000000000001-release-notes.md',
                    text: '# Release\npassword=[redacted:assignment]\nShip after review.',
                }),
            ],
        }),
    ]);
    expect(h.stdout()).not.toContain('synthetic-password');
    expect(h.stdout()).not.toContain('synthetic-document-secret');
});

it('lists export chats before import without authentication', async () => {
    const h = await fixture();
    expect(
        await runCloud(h.host, ['chat', 'local', '--from', 'claude-export', h.archive, '--json']),
        h.stderr()
    ).toBe(0);
    expect(JSON.parse(h.stdout()).sessions).toEqual([
        expect.objectContaining({ id: '10000000-0000-4000-8000-000000000001' }),
    ]);
    expect(h.stdout()).not.toContain('synthetic-password');
});

it('refuses a headless upload without consent before sending any request', async () => {
    const h = await fixture();
    await signInFixture(h.dir);
    expect(
        await runCloud(h.host, ['chat', 'import', '--from', 'claude-export', h.archive, '--json']),
        h.stderr()
    ).toBe(4);
    expect(h.calls).toEqual([]);
    expect(h.stderr()).toContain('needs_confirmation');
});

it('discovers the Claude Code projects layout, previews it, and sends only redacted inert transcript text', async () => {
    const h = await fixture();
    const project = path.join(h.dir, '.claude', 'projects', '-work-api');
    await mkdir(project, { recursive: true });
    await writeFile(
        path.join(project, 'synthetic-session.jsonl'),
        claudeSession('synthetic-session')
    );
    expect(
        await runCloud(h.host, ['chat', 'local', '--from', 'claude-code', '--json']),
        h.stderr()
    ).toBe(0);
    expect(h.stdout()).toContain('synthetic-session');
    h.reset();
    expect(
        await runCloud(h.host, [
            'chat',
            'import',
            '--from',
            'claude-code',
            'synthetic-session',
            '--dry-run',
            '--json',
        ]),
        h.stderr()
    ).toBe(0);
    expect(h.stdout()).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    h.reset();
    const fetch: CloudRuntime['fetch'] = async (input, init) => {
        const request = new globalThis.Request(input, init);
        if (request.url !== 'https://app.dexto.ai/mcp')
            return Response.json({ resource: 'https://app.dexto.ai/mcp', dexto_app_scopes: {} });
        const message = z
            .object({
                id: z.number(),
                params: z.object({
                    name: z.string(),
                    arguments: z.record(z.string(), z.unknown()),
                }),
            })
            .parse(await request.json());
        h.calls.push(message.params);
        return Response.json({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                content: [],
                structuredContent: {
                    session: { id: 'chat-code' },
                    status: 'imported',
                    url: 'https://app.dexto.ai/c/chat-code',
                },
            },
        });
    };
    await signInFixture(h.dir);
    const host = { ...h.host, runtime: { ...h.runtime, fetch } };
    expect(
        await runCloud(host, [
            'chat',
            'import',
            '--from',
            'claude-code',
            'synthetic-session',
            '--yes',
            '--json',
        ]),
        h.stderr() + h.stdout()
    ).toBe(0);
    expect(h.calls).toEqual([
        expect.objectContaining({
            name: 'dexto_chat_import',
            arguments: expect.objectContaining({
                source: 'claude-code',
                sourceSessionId: 'synthetic-session',
            }),
        }),
    ]);
    expect(JSON.stringify(h.calls)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(JSON.stringify(h.calls)).toContain('Bash');
});

it('imports the export into private chats, Projects and redacted Project files, and safely resumes the same export', async () => {
    const h = await fixture();
    const mcp = 'https://app.dexto.ai/mcp';
    await signInFixture(h.dir);
    const uploads: string[] = [];
    const created = new Set<string>();
    let saved: Record<string, unknown> | null = null;
    let reservation: Record<string, unknown> = {};
    const fetch: CloudRuntime['fetch'] = async (input, init) => {
        const request = new globalThis.Request(input, init);
        if (request.url === 'https://uploads.example.test/document') {
            uploads.push(await request.text());
            saved = {
                id: 'file-1',
                kind: 'file',
                name: reservation.name,
                parentId: 'folder-1',
                revision: 1,
                sha256: reservation.sha256,
                size: reservation.size,
                trashedAt: null,
            };
            return Response.json({ item: saved });
        }
        if (request.url !== mcp) return Response.json({ resource: mcp, dexto_app_scopes: {} });
        const message = z
            .object({
                id: z.number(),
                params: z.object({
                    name: z.string(),
                    arguments: z.record(z.string(), z.unknown()),
                }),
            })
            .parse(await request.json());
        const call = message.params;
        h.calls.push(call);
        let value: unknown;
        if (call.name === 'dexto_project_import') {
            const prior = created.has('project');
            created.add('project');
            value = {
                project: { id: '60000000-0000-4000-8000-000000000001' },
                filesFolder: { folderId: 'folder-1' },
                status: prior ? 'already_imported' : 'imported',
            };
        } else if (call.name === 'dexto_project_get') value = { folder: { id: 'folder-1' } };
        else if (call.name === 'dexto_drive' && call.arguments.action === 'list')
            value = { items: saved === null ? [] : [saved], nextOffset: null };
        else if (call.name === 'dexto_drive' && call.arguments.action === 'upload') {
            reservation = call.arguments;
            value = { upload: { method: 'PUT', url: 'https://uploads.example.test/document' } };
        } else if (call.name === 'dexto_chat_import') {
            const prior = created.has('chat');
            created.add('chat');
            value = {
                session: { id: 'chat-1' },
                status: prior ? 'already_imported' : 'imported',
                url: 'https://app.dexto.ai/c/chat-1',
            };
        } else throw new Error(`Unexpected MCP tool ${call.name}`);
        return Response.json({
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [], structuredContent: value },
        });
    };
    const host = { ...h.host, runtime: { ...h.runtime, fetch } };
    expect(
        await runCloud(host, [
            'chat',
            'import',
            '--from',
            'claude-export',
            h.archive,
            '--yes',
            '--json',
        ]),
        h.stderr()
    ).toBe(0);
    expect(JSON.parse(h.stdout()).sessions).toEqual([
        expect.objectContaining({ status: 'imported' }),
    ]);
    expect(created).toEqual(new Set(['project', 'chat']));
    expect(uploads).toEqual(['# Release\npassword=[redacted:assignment]\nShip after review.']);
    expect(h.calls.find((call) => call.name === 'dexto_project_import')?.arguments).toMatchObject({
        sourceAgent: 'claude_export',
        sourceId: '20000000-0000-4000-8000-000000000001',
    });
    expect(h.calls.find((call) => call.name === 'dexto_chat_import')?.arguments).toMatchObject({
        source: 'claude-export',
        sourceSessionId: '10000000-0000-4000-8000-000000000001',
    });
    expect(JSON.stringify(h.calls)).not.toContain('synthetic-password');
    h.reset();
    expect(
        await runCloud(host, [
            'chat',
            'import',
            '--from',
            'claude-export',
            h.archive,
            '--yes',
            '--json',
        ]),
        h.stderr()
    ).toBe(0);
    expect(JSON.parse(h.stdout()).sessions[0].status).toBe('already_imported');
    expect(uploads).toHaveLength(1);
});
