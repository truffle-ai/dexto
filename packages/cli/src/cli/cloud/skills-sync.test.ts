import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCloudClient } from '@dexto/cloud-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { syncCloudSkills } from './skills-sync.js';
import { tarArchive } from './tar.js';

const encoder = new globalThis.TextEncoder();

interface CloudSkill {
    id: string;
    slug: string;
    digest: string | null;
    files: Record<string, string>;
}

let directory: string;
let downloads: string[];

beforeEach(async () => {
    directory = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-cloud-skills-')), 'cache');
    downloads = [];
});

afterEach(async () => {
    await rm(path.dirname(directory), { recursive: true, force: true });
});

async function skillFolders() {
    return (await readdir(directory)).filter((name) => !name.startsWith('.'));
}

function cloud(skills: CloudSkill[], options: { failDownloads?: boolean } = {}) {
    const fetch = async (request: globalThis.Request) => {
        const url = new URL(request.url);
        if (url.pathname === '/v1/skills')
            return Response.json({
                data: skills.map((skill) => ({
                    description: '',
                    id: skill.id,
                    object: 'skill',
                    release: skill.digest === null ? null : { digest: skill.digest, version: '1' },
                    slug: skill.slug,
                    source: 'user',
                    title: skill.slug,
                    visibility: 'private',
                })),
                has_more: false,
                next_after: null,
                object: 'list',
            });
        const skill = skills.find((each) => url.pathname === `/v1/skills/${each.id}/bundle`);
        if (skill === undefined) return new Response(null, { status: 404 });
        downloads.push(skill.slug);
        if (options.failDownloads === true) throw new TypeError('fetch failed');
        const files = Object.entries(skill.files).map(([filePath, text]) => ({
            bytes: encoder.encode(text),
            executable: false,
            path: filePath,
        }));
        return new Response(tarArchive(files), {
            headers: { 'content-type': 'application/x-tar' },
        });
    };
    return createCloudClient({
        apiBaseUrl: 'https://api.dexto.test',
        cloudProject: null,
        fetch: (input, init) => fetch(new globalThis.Request(input, init)),
        token: 'person-token',
    });
}

const notes = (digest: string): CloudSkill => ({
    digest,
    files: {
        'SKILL.md': `---\nname: release-notes\n---\nRelease ${digest}`,
        'references/template.md': '# Template',
    },
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'release-notes',
});

describe('syncCloudSkills', () => {
    it('writes each released Skill into its own folder and skips one with no release', async () => {
        const draft: CloudSkill = {
            digest: null,
            files: {},
            id: '00000000-0000-4000-8000-000000000002',
            slug: 'draft',
        };

        await syncCloudSkills({ client: cloud([notes('a'), draft]), directory });

        expect(await skillFolders()).toEqual(['release-notes']);
        expect(await readFile(path.join(directory, 'release-notes', 'SKILL.md'), 'utf8')).toContain(
            'Release a'
        );
        expect(
            await readFile(path.join(directory, 'release-notes', 'references/template.md'), 'utf8')
        ).toBe('# Template');
    });

    it('downloads only Skills whose files changed, and removes Skills that left the library', async () => {
        const other: CloudSkill = {
            digest: 'x',
            files: { 'SKILL.md': '---\nname: other\n---\nOther' },
            id: '00000000-0000-4000-8000-000000000003',
            slug: 'other',
        };
        await syncCloudSkills({ client: cloud([notes('a'), other]), directory });
        downloads = [];

        await syncCloudSkills({ client: cloud([notes('a')]), directory });
        expect(downloads).toEqual([]);
        expect(await skillFolders()).toEqual(['release-notes']);

        await syncCloudSkills({ client: cloud([notes('b')]), directory });
        expect(downloads).toEqual(['release-notes']);
        expect(await readFile(path.join(directory, 'release-notes', 'SKILL.md'), 'utf8')).toContain(
            'Release b'
        );
    });

    it('keeps the last synced Skills when a download fails', async () => {
        await syncCloudSkills({ client: cloud([notes('a')]), directory });

        await expect(
            syncCloudSkills({ client: cloud([notes('b')], { failDownloads: true }), directory })
        ).rejects.toThrow();

        expect(await readFile(path.join(directory, 'release-notes', 'SKILL.md'), 'utf8')).toContain(
            'Release a'
        );
    });
});
