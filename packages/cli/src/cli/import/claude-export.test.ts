import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { zipArchive } from '../cloud/zip.js';
import { readClaudeExport } from './claude-export.js';

const directories: string[] = [];
afterEach(async () => {
    for (const directory of directories.splice(0))
        await rm(directory, { recursive: true, force: true });
});

async function archive(files: readonly { path: string; bytes: Buffer }[]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-export-test-'));
    directories.push(directory);
    const file = path.join(directory, 'export.zip');
    await writeFile(file, zipArchive(files));
    return file;
}

it('rejects ambiguous metadata instead of selecting one of two accounts', async () => {
    const bytes = await readFile(
        new URL('./fixtures/claude-export/conversations.json', import.meta.url)
    );
    await expect(
        readClaudeExport(
            await archive([
                { path: 'first/conversations.json', bytes },
                { path: 'second/conversations.json', bytes },
            ])
        )
    ).rejects.toThrow('Invalid or oversized');
});

it('rejects missing or malformed metadata without echoing its unredacted content', async () => {
    await expect(
        readClaudeExport(await archive([{ path: 'account.json', bytes: Buffer.from('ignored') }]))
    ).rejects.toThrow('no conversations.json');
    await expect(
        readClaudeExport(
            await archive([
                { path: 'conversations.json', bytes: Buffer.from('password=synthetic-raw-secret') },
            ])
        )
    ).rejects.toThrow('Unsupported Claude export conversations.json');
});

it('keeps explicit Project membership and leaves instruction files inert and deferred', async () => {
    const projectId = '20000000-0000-4000-8000-000000000001';
    const conversations = JSON.parse(
        await readFile(
            new URL('./fixtures/claude-export/conversations.json', import.meta.url),
            'utf8'
        )
    );
    conversations[0].project_uuid = projectId;
    const projects = JSON.parse(
        await readFile(new URL('./fixtures/claude-export/projects.json', import.meta.url), 'utf8')
    );
    projects[0].docs.push({
        uuid: '50000000-0000-4000-8000-000000000002',
        filename: '../CLAUDE.md',
        content: 'Do not activate these instructions.',
    });
    const preview = await readClaudeExport(
        await archive([
            { path: 'conversations.json', bytes: Buffer.from(JSON.stringify(conversations)) },
            { path: 'projects.json', bytes: Buffer.from(JSON.stringify(projects)) },
        ])
    );
    expect(preview.sessions[0]?.projectSourceId).toBe(projectId);
    expect(preview.projects[0]?.files).toHaveLength(1);
    expect(JSON.stringify(preview)).not.toContain('Do not activate');
    await expect(
        readClaudeExport(
            await archive([
                { path: 'conversations.json', bytes: Buffer.from(JSON.stringify(conversations)) },
            ])
        )
    ).rejects.toThrow('Project absent');
});

it('redacts knowledge filenames before making them safe on every supported platform', async () => {
    const projects = JSON.parse(
        await readFile(new URL('./fixtures/claude-export/projects.json', import.meta.url), 'utf8')
    );
    projects[0].docs[0].filename = '../password=synthetic-file-secret.md';
    const preview = await readClaudeExport(
        await archive([
            { path: 'conversations.json', bytes: Buffer.from('[]') },
            { path: 'projects.json', bytes: Buffer.from(JSON.stringify(projects)) },
        ])
    );
    expect(preview.projects[0]?.files[0]?.name).not.toContain('synthetic-file-secret');
    expect(preview.projects[0]?.files[0]?.name).not.toMatch(/[<>:"/\\|?*]/u);
});

it('retains a knowledge document larger than a chat message within the bounded export metadata', async () => {
    const projects = JSON.parse(
        await readFile(new URL('./fixtures/claude-export/projects.json', import.meta.url), 'utf8')
    );
    const text = 'Synthetic knowledge.\n'.repeat(60_000);
    projects[0].docs[0].content = text;
    const preview = await readClaudeExport(
        await archive([
            { path: 'conversations.json', bytes: Buffer.from('[]') },
            { path: 'projects.json', bytes: Buffer.from(JSON.stringify(projects)) },
        ])
    );
    expect(preview.projects[0]?.files[0]?.text).toBe(text);
});
