import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCloudClient } from '@dexto/cloud-client';
import type { InternalMessage } from '@dexto/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LocalChat } from './engine.js';
import { createChatSyncHost, type ChatSyncHost, type SyncSignIn } from './host.js';
import { firstRunNotice } from './notices.js';
import { chatSyncStore, type ChatSyncStore } from './store.js';

const ACCOUNT = 'org_1-acct_1';
const CLOUD_CHAT = '11111111-1111-4111-8111-111111111111';
const CWD = '/work/app';

let store: ChatSyncStore;
let dir: string;
let signIn: SyncSignIn['kind'];
let sent: { method: string; from: number | null }[];
let finished: ((chatId: string) => Promise<void>) | null;
let messages: InternalMessage[];

function host(): ChatSyncHost {
    const client = createCloudClient({
        apiBaseUrl: 'https://api.dexto.ai',
        token: 'token',
        cloudProject: null,
        fetch: async (input, init) => {
            const request =
                input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
            const text = await request.text();
            const body: unknown = text === '' ? null : JSON.parse(text);
            const record = typeof body === 'object' && body !== null ? body : null;
            const from = record === null ? null : Number(Reflect.get(record, 'from_index'));
            const batch: unknown = record === null ? null : Reflect.get(record, 'messages');
            const count = Array.isArray(batch) ? batch.length : 0;
            sent.push({ method: request.method, from });
            return request.method === 'DELETE'
                ? Response.json({ deleted: true, id: CLOUD_CHAT, object: 'synced_chat' })
                : Response.json({
                      id: CLOUD_CHAT,
                      next_index: (from ?? 0) + count,
                      object: 'synced_chat',
                      redactions: {},
                      status: 'created',
                      url: 'https://app.dexto.ai/chats/x',
                  });
        },
    });
    const chat = (id: string): LocalChat => ({
        id,
        title: 'Plan',
        cwd: CWD,
        gitBranch: null,
        messages,
        parentIds: [],
    });
    return createChatSyncHost({
        store,
        signIn: async () =>
            signIn === 'ready'
                ? { kind: 'ready', connection: { client, account: ACCOUNT, signInId: 'sign-in' } }
                : { kind: signIn },
        readChat: async (id) => chat(id),
        now: () => Date.parse('2026-11-04T10:00:00.000Z'),
        schedule: () => undefined,
        machineName: 'laptop',
        cliVersion: '2.0.0',
        cwd: CWD,
        onRunComplete: (listener) => {
            finished = listener;
            return () => {
                finished = null;
            };
        },
    });
}

async function runFinished(chatId: string): Promise<void> {
    await finished?.(chatId);
}

beforeEach(async () => {
    dir = path.join(await mkdtemp(path.join(tmpdir(), 'chat-sync-')), 'sync');
    store = chatSyncStore(dir);
    signIn = 'ready';
    sent = [];
    finished = null;
    messages = [{ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 }];
    // Sync is off by default in 2.0; these tests are about a person who turned it on.
    await optIn();
});

async function optIn(): Promise<void> {
    await store.updateSettings((current) => ({
        ...current,
        sync: 'on',
        syncChosenAt: '2026-11-04T09:00:00.000Z',
    }));
}

describe('chat sync off by default', () => {
    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(tmpdir(), 'chat-sync-')), 'sync');
        store = chatSyncStore(dir);
    });

    it('syncs nothing and shows no notice for someone signed in who never turned it on', async () => {
        const sync = host();
        const notices: string[] = [];
        sync.onNotice((text) => notices.push(text));

        await sync.start('s1');
        await runFinished('s1');

        expect(notices).toEqual([]);
        expect(sent).toEqual([]);
        expect(await sync.command('sync', [], 's1')).toBe(
            'Chat sync is off for every chat. Turn it on with /sync on.'
        );
    });

    it('turns on only when asked, says once what syncs, then syncs after each run', async () => {
        const sync = host();
        await sync.start('s1');

        expect(await sync.command('sync', ['on'], 's1')).toBe(firstRunNotice({ canSync: true }));
        await sync.engine.sync('s1');
        expect(sent.map((request) => request.method)).toEqual(['POST']);
        expect((await store.readSettings()).syncChosenAt).toBe('2026-11-04T10:00:00.000Z');

        await sync.command('sync', ['off'], 's1');
        expect(await sync.command('sync', ['on'], 's1')).toBe(
            'Chat sync is on. Your chats sync to your Dexto Cloud account.'
        );
    });

    it('says a sign-in is needed when turned on while signed out, and syncs nothing yet', async () => {
        signIn = 'signed_out';
        const sync = host();
        await sync.start('s1');

        const reply = await sync.command('sync', ['on'], 's1');

        expect(reply).toMatch(/^Chat sync is on\./u);
        expect(reply).toMatch(/not signed in to Dexto\. Run \/login to start syncing/u);
        // Let the upload the reply started finish while still signed out.
        await sync.engine.sync('s1');
        await runFinished('s1');
        expect(sent).toEqual([]);
    });

    it("keeps a beta's saved default of on off, until the person turns it on", async () => {
        await store.readSettings();
        await writeFile(
            path.join(dir, 'settings.json'),
            JSON.stringify({
                machineId: '7f2a50dd-12f8-40e2-87cb-ecdbc589cb4c',
                noticeShownAt: '2026-11-04T09:00:00.000Z',
                sync: 'on',
                projectsOff: [],
                privateChats: [],
            })
        );
        const sync = host();

        await sync.start('s1');
        await runFinished('s1');

        expect(sent).toEqual([]);
        expect(await sync.command('sync', [], 's1')).toMatch(/off for every chat/u);
    });
});

describe('createChatSyncHost', () => {
    it('shows the first-run notice once, before the first chat syncs', async () => {
        const sync = host();
        const notices: string[] = [];
        const sentWhenNoticed: number[] = [];
        sync.onNotice((text) => {
            notices.push(text);
            sentWhenNoticed.push(sent.length);
        });

        await sync.start('s1');
        await runFinished('s1');

        expect(notices).toEqual([firstRunNotice({ canSync: true })]);
        expect(sentWhenNoticed).toEqual([0]);
        expect(sent.map((request) => request.method)).toEqual(['POST']);
        expect((await store.readSettings()).noticeShownAt).not.toBeNull();
    });

    it('keeps notices for the screen until it listens', async () => {
        const sync = host();
        await sync.start('s1');

        const notices: string[] = [];
        sync.onNotice((text) => notices.push(text));

        expect(notices).toHaveLength(1);
    });

    it('shows no notice and syncs nothing while signed out, then shows it after sign-in', async () => {
        signIn = 'signed_out';
        const sync = host();
        const notices: string[] = [];
        sync.onNotice((text) => notices.push(text));

        await sync.start('s1');
        await runFinished('s1');
        expect(notices).toEqual([]);
        expect(sent).toEqual([]);

        signIn = 'ready';
        await runFinished('s1');
        expect(notices).toHaveLength(1);
        expect(sent).toHaveLength(1);
    });

    it('asks a sign-in from before chat sync to sign in again, and syncs nothing', async () => {
        signIn = 'needs_login';
        const sync = host();
        const notices: string[] = [];
        sync.onNotice((text) => notices.push(text));

        await sync.start('s1');

        expect(notices).toEqual([firstRunNotice({ canSync: false })]);
        expect(notices[0]).toMatch(/Run \/login/u);
        expect(sent).toEqual([]);
        expect(await sync.command('sync', [], 's1')).toMatch(/Run \/login/u);
    });

    it('turns sync off and on everywhere', async () => {
        const sync = host();
        await sync.start(null);

        expect(await sync.command('sync', ['off'], 's1')).toMatch(/off for every chat/u);
        await runFinished('s1');
        expect(sent).toEqual([]);
        expect(await sync.command('sync', [], 's1')).toMatch(/off for every chat/u);

        expect(await sync.command('sync', ['on'], 's1')).toMatch(/Chat sync is on/u);
        // The reply doesn't wait for the upload it starts.
        await sync.engine.sync('s1');
        expect(sent.map((request) => request.method)).toEqual(['POST']);
    });

    it('turns sync off and on for this folder', async () => {
        const sync = host();
        sync.onNotice(() => undefined);
        await sync.start(null);

        expect(await sync.command('sync', ['off', 'project'], 's1')).toBe(
            `Chat sync is off for chats in ${CWD}. Chats already synced keep their copies in Dexto Cloud; use /private in a chat to delete its copy.`
        );
        await runFinished('s1');
        expect(sent).toEqual([]);
        expect(await sync.command('sync', [], 's1')).toMatch(`off for chats in ${CWD}`);
        expect((await store.readSettings()).projectsOff).toEqual([CWD]);

        await sync.command('sync', ['on', 'project'], 's1');
        // The reply doesn't wait for the upload it starts.
        await sync.engine.sync('s1');
        expect((await store.readSettings()).projectsOff).toEqual([]);
        expect(sent).toHaveLength(1);
    });

    it('makes a chat private, deleting its copy, and lets it sync again as a new chat', async () => {
        const sync = host();
        sync.onNotice(() => undefined);
        await sync.start('s1');
        await runFinished('s1');

        expect(await sync.command('private', [], 's1')).toBe(
            'This chat is private: it stays on this machine, and its copy in Dexto Cloud is deleted.'
        );
        expect(sent.map((request) => request.method)).toEqual(['POST', 'DELETE']);
        await runFinished('s1');
        expect(sent).toHaveLength(2);
        expect(await sync.command('sync', [], 's1')).toMatch(/This chat is private/u);

        expect(await sync.command('private', ['off'], 's1')).toMatch(/syncs again/u);
        // The reply doesn't wait for the upload it starts.
        await sync.engine.sync('s1');
        expect(sent.at(-1)).toEqual({ method: 'POST', from: 0 });
    });

    it('explains how to use each command when given anything else', async () => {
        const sync = host();

        expect(await sync.command('sync', ['maybe'], 's1')).toMatch(/^Usage: \/sync/u);
        expect(await sync.command('sync', ['off', 'here'], 's1')).toMatch(/^Usage: \/sync/u);
        expect(await sync.command('private', ['now'], 's1')).toMatch(/^Usage: \/private/u);
        expect(await sync.command('private', [], null)).toMatch(/no chat/u);
    });

    it('syncs nothing on the launch that shows the notice until a run ends after it', async () => {
        const sync = host();
        sync.onNotice(() => undefined);
        await sync.start('s1');
        expect(sent).toEqual([]);

        await runFinished('s1');
        expect(sent).toHaveLength(1);
    });

    it('counts the notice as shown only once the screen shows it', async () => {
        const sync = host();
        await sync.start('s1');
        await runFinished('s1');
        expect((await store.readSettings()).noticeShownAt).toBeNull();
        expect(sent).toEqual([]);

        sync.onNotice(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await runFinished('s1');
        expect((await store.readSettings()).noticeShownAt).not.toBeNull();
        expect(sent).toHaveLength(1);
    });

    it("says when a private chat's copy could not be deleted yet, or never synced", async () => {
        const sync = host();
        sync.onNotice(() => undefined);
        expect(await sync.command('private', [], 'never-synced')).toMatch(/had not synced/u);

        await runFinished('s2');
        signIn = 'signed_out';
        expect(await sync.command('private', [], 's2')).toMatch(/as soon as the CLI can reach/u);
    });

    it('says once why nothing syncs when the settings cannot be read', async () => {
        const sync = host();
        const notices: string[] = [];
        sync.onNotice((text) => notices.push(text));
        await sync.start('s1');
        await runFinished('s1');
        await writeFile(path.join(dir, 'settings.json'), '{ not json');

        await runFinished('s1');
        await runFinished('s1');

        expect(notices.filter((text) => /can't be read/u.test(text))).toHaveLength(1);
    });
});
