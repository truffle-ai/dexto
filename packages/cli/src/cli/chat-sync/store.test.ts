import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatSyncStore, syncAllowed, type ChatSyncSettings } from './store.js';

const CLOUD_CHAT = '7f2a50dd-12f8-40e2-87cb-ecdbc589cb4c';

async function freshStore() {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'chat-sync-')), 'chat-sync');
    return { dir, store: chatSyncStore(dir) };
}

describe('chatSyncStore', () => {
    it('starts with sync on, no notice shown, and keeps one machine id', async () => {
        const { store } = await freshStore();

        const first = await store.readSettings();
        const second = await store.readSettings();

        expect(first).toMatchObject({ sync: 'on', noticeShownAt: null, projectsOff: [] });
        expect(second.machineId).toBe(first.machineId);
    });

    it('keeps its files readable only by this user', async () => {
        const { dir, store } = await freshStore();

        await store.writeChat('org_1-acct_1', 'session-1', {
            status: 'syncing',
            cloudChatId: CLOUD_CHAT,
            nextIndex: 3,
            sentCount: 3,
        });

        expect((await stat(dir)).mode & 0o777).toBe(0o700);
        expect((await stat(path.join(dir, 'org_1-acct_1'))).mode & 0o777).toBe(0o700);
        const file = path.join(dir, 'org_1-acct_1', 'chats', 'session-1.json');
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        expect(await readdir(path.dirname(file))).toEqual(['session-1.json']);
        expect(await store.readChat('org_1-acct_1', 'session-1')).toMatchObject({ nextIndex: 3 });
    });

    it('starts a chat over when its file is not one it wrote', async () => {
        const { dir, store } = await freshStore();
        await store.writeChat('a', 'c', {
            status: 'stopped',
            reason: 'sync_diverged',
            cloudChatId: null,
        });
        await writeFile(path.join(dir, 'a', 'chats', 'c.json'), '{"status":"unknown"}');

        expect(await store.readChat('a', 'c')).toBeNull();
    });

    it('refuses a chat id or account that could leave its folder', async () => {
        const { store } = await freshStore();

        await expect(store.readChat('a', '../settings')).rejects.toThrow();
        await expect(store.readAccount('../a')).rejects.toThrow();
    });
});

describe('settings it cannot read', () => {
    it('are never replaced, and nothing syncs while they cannot be read', async () => {
        const { dir, store } = await freshStore();
        await store.readSettings();
        await writeFile(path.join(dir, 'settings.json'), '{"sync": "on", "privateChats": [');

        await expect(store.readSettings()).rejects.toThrow(/settings/u);
        expect(await readFile(path.join(dir, 'settings.json'), 'utf8')).toBe(
            '{"sync": "on", "privateChats": ['
        );
    });

    it('keep what a newer version added', async () => {
        const { dir, store } = await freshStore();
        const settings = await store.readSettings();
        await writeFile(
            path.join(dir, 'settings.json'),
            JSON.stringify({ ...settings, addedLater: true })
        );

        await store.updateSettings((current) => ({ ...current, sync: 'off' }));

        expect(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'))).toMatchObject({
            addedLater: true,
            sync: 'off',
        });
    });
});

describe('syncAllowed', () => {
    const settings: ChatSyncSettings = {
        machineId: '7f2a50dd-12f8-40e2-87cb-ecdbc589cb4c',
        noticeShownAt: '2026-11-04T10:00:00.000Z',
        sync: 'on',
        projectsOff: ['/work/secret-project'],
        privateChats: ['private-chat'],
    };

    it('turns sync off everywhere, per folder and its subfolders, and per chat', () => {
        expect(syncAllowed(settings, { id: 'c', cwd: '/work/app', parentIds: [] })).toBe(true);
        expect(syncAllowed(settings, { id: 'c', cwd: null, parentIds: [] })).toBe(true);
        expect(syncAllowed(settings, { id: 'c', cwd: '/work/secret-project', parentIds: [] })).toBe(
            false
        );
        expect(
            syncAllowed(settings, { id: 'c', cwd: '/work/secret-project/api', parentIds: [] })
        ).toBe(false);
        expect(
            syncAllowed(settings, { id: 'c', cwd: '/work/secret-project-2', parentIds: [] })
        ).toBe(true);
        expect(syncAllowed(settings, { id: 'private-chat', cwd: '/work/app', parentIds: [] })).toBe(
            false
        );
        expect(
            syncAllowed(settings, { id: 'fork', cwd: '/work/app', parentIds: ['private-chat'] })
        ).toBe(false);
        // A folder whose name starts with `..` is inside its parent.
        expect(
            syncAllowed(
                { ...settings, projectsOff: ['/work'] },
                { id: 'c', cwd: '/work/..app', parentIds: [] }
            )
        ).toBe(false);
        expect(
            syncAllowed({ ...settings, sync: 'off' }, { id: 'c', cwd: '/work/app', parentIds: [] })
        ).toBe(false);
    });
});
