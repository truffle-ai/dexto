import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    importPersonalSkill,
    preparePersonalSkill,
    selectPersonalSkillSlug,
} from './import-skills.js';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import type { CommandContext } from '../command.js';
import { importCommands } from './import.js';

const endpoint = 'https://fake.invalid/mcp';
const upload = 'https://fake.invalid/upload';

/** A fake MCP skills endpoint and upload receiver; no network or real credentials. */
function fakeEndpoint(initial: string[] = []) {
    const existing = new Set(initial);
    const requests: { name: string; input: Record<string, unknown> }[] = [];
    const bundles: Uint8Array[] = [];
    const base = nodeCloudRuntime(new AbortController().signal);
    const runtime = {
        ...base,
        prompt: null,
        fetch: async (input: string | URL | globalThis.Request, init?: RequestInit) => {
            const request = new globalThis.Request(input, init);
            if (request.url === upload) {
                bundles.push(new Uint8Array(await request.arrayBuffer()));
                return new globalThis.Response(null, { status: 200 });
            }
            if (request.url !== endpoint) throw new Error('Unexpected network destination');
            const message: {
                id: number;
                method: string;
                params: { name: string; arguments: Record<string, unknown> };
            } = await request.json();
            const { name, arguments: args } = message.params;
            requests.push({ name, input: args });
            let data: unknown;
            let isError = false;
            if (name === 'dexto_skills_search') {
                data = {
                    skills: [...existing]
                        .filter((s) => s.includes(String(args.query)))
                        .map((slug) => ({ slug, source: 'user', visibility: 'private' })),
                };
            } else if (name === 'dexto_upload_prepare') {
                data = { url: upload, method: 'PUT', headers: {}, path: 'uploads/test.tar' };
            } else if (name === 'dexto_skill_bundle_import') {
                if (args.mode !== 'create') throw new Error('Never overwrite a skill');
                const slug = String(args.slug);
                if (existing.has(slug)) {
                    isError = true;
                    data = { status: 'conflict', message: 'Already exists' };
                } else {
                    existing.add(slug);
                    data = { slug, title: String(args.title), location: { skillId: `id-${slug}` } };
                }
            } else throw new Error('Unexpected operation');
            return globalThis.Response.json({
                jsonrpc: '2.0',
                id: message.id,
                result: { content: [], structuredContent: data, isError },
            });
        },
    };
    const context: CommandContext = {
        runtime,
        output: createOutput(runtime, 'json'),
        invocation: ['import'],
        overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
        connection: async () => ({
            kind: 'oauth',
            token: 'test-token',
            source: 'login',
            profile: 'default',
            apiBaseUrl: 'https://fake.invalid',
            cloudProject: null,
            login: {
                kind: 'oauth',
                accessToken: 'test-token',
                refreshToken: 'test-refresh',
                expiresAt: '2099-01-01T00:00:00.000Z',
                clientId: 'test',
                appUrl: 'https://fake.invalid',
                apiBaseUrl: 'https://fake.invalid',
                resource: endpoint,
                tokenEndpoint: 'https://fake.invalid/token',
                scopes: ['skills:write'],
                savedAt: '2026-01-01T00:00:00.000Z',
                signedInAs: null,
                cloudProject: null,
            },
        }),
        client: async () => {
            throw new Error('Unexpected client');
        },
    };
    return { context, existing, requests, bundles };
}

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'fake-skill-'));
    const folder = path.join(root, 'sample');
    await mkdir(folder);
    await writeFile(
        path.join(folder, 'SKILL.md'),
        '---\nname: sample\ndescription: A sample skill\n---\npassword=supersecretvalue\n'
    );
    return { source: 'claude-code' as const, name: 'sample', path: folder };
}

describe('personal skills against a fake MCP endpoint', () => {
    it('requires consent and keeps provisional uploads blocked before contacting the endpoint', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'fake-skill-home-'));
        const folder = path.join(home, '.claude', 'skills', 'sample');
        await mkdir(folder, { recursive: true });
        await writeFile(
            path.join(folder, 'SKILL.md'),
            '---\nname: sample\ndescription: Sample\n---\n'
        );
        const fake = fakeEndpoint();
        const context = {
            ...fake.context,
            runtime: { ...fake.context.runtime, homeDirectory: home, environment: {} },
        };
        const command = importCommands[0];
        if (command === undefined) throw new Error('missing import command');
        await expect(
            command.run(context, {
                positionals: [],
                values: { select: 'skill:claude-code:sample' },
            })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        await expect(
            command.run(context, {
                positionals: [],
                values: { select: 'skill:claude-code:sample', yes: true },
            })
        ).rejects.toThrow(/verified provenance/i);
        expect(fake.requests).toEqual([]);
        expect(fake.bundles).toEqual([]);
    });
    it('sends a redacted bundle with provenance and never update mode', async () => {
        const skill = await fixture();
        const prepared = await preparePersonalSkill(skill);
        const fake = fakeEndpoint();
        const slug = await selectPersonalSkillSlug(fake.context, prepared, 'ask', new Set());
        expect(slug).toBe('sample');
        if (slug === null) throw new Error('expected selection');
        expect(await importPersonalSkill(fake.context, skill, prepared, slug)).toMatchObject({
            status: 'imported',
            slug: 'sample',
        });
        const sent = fake.requests.find((request) => request.name === 'dexto_skill_bundle_import');
        expect(sent?.input).toMatchObject({
            mode: 'create',
            uploadPath: 'uploads/test.tar',
            importProvenance: {
                sourceAgent: 'claude_code',
                sourceId: 'sample',
                sourcePath: '~/.claude/skills/sample',
            },
        });
        expect(fake.bundles).toHaveLength(1);
        expect(Buffer.from(fake.bundles[0] ?? []).toString('utf8')).not.toContain(
            'supersecretvalue'
        );
    });
    it('requires a choice for JSON clashes, skips without uploading, and renames without overwriting', async () => {
        const skill = await fixture();
        const prepared = await preparePersonalSkill(skill);
        const fake = fakeEndpoint(['sample']);
        await expect(
            selectPersonalSkillSlug(fake.context, prepared, 'ask', new Set())
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(await selectPersonalSkillSlug(fake.context, prepared, 'skip', new Set())).toBeNull();
        expect(fake.bundles).toHaveLength(0);
        const slug = await selectPersonalSkillSlug(fake.context, prepared, 'rename', new Set());
        expect(slug).toBe('sample-2');
        if (slug === null) throw new Error('expected rename');
        await importPersonalSkill(fake.context, skill, prepared, slug);
        expect([...fake.existing].sort()).toEqual(['sample', 'sample-2']);
        expect(
            fake.requests
                .filter((request) => request.name === 'dexto_skill_bundle_import')
                .every((request) => request.input.mode === 'create')
        ).toBe(true);
    });
    it('does not overwrite when another import claims the slug after discovery', async () => {
        const skill = await fixture();
        const prepared = await preparePersonalSkill(skill);
        const fake = fakeEndpoint();
        const slug = await selectPersonalSkillSlug(fake.context, prepared, 'ask', new Set());
        if (slug === null) throw new Error('expected selection');
        fake.existing.add(slug);
        await expect(importPersonalSkill(fake.context, skill, prepared, slug)).rejects.toThrow(
            /already exists/i
        );
        expect([...fake.existing]).toEqual(['sample']);
    });
});
