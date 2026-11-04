import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCloudClient } from '@dexto/cloud-client';
import type { InternalMessage } from '@dexto/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createChatSync, type ChatSync, type LocalChat } from './engine.js';
import { chatSyncStore, type ChatSyncStore } from './store.js';

const ACCOUNT = 'org_1-acct_1';
const CLOUD_CHAT = '11111111-1111-4111-8111-111111111111';
const OTHER_CLOUD_CHAT = '22222222-2222-4222-8222-222222222222';

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

interface SentRequest {
    readonly method: string;
    readonly path: string;
    readonly body: {
        from_index: number;
        local_chat_id: string;
        messages: { index: number; role: string }[];
        title: string;
    } | null;
}

/** A /v1 server that answers each request from `answer`, recording what was sent. */
function fakeServer(answer: (request: SentRequest) => Reply) {
    const sent: SentRequest[] = [];
    const fetch = async (input: globalThis.Request | string | URL, init?: RequestInit) => {
        const request =
            input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
        const text = await request.text();
        const recorded: SentRequest = {
            method: request.method,
            path: new URL(request.url).pathname,
            body: text === '' ? null : JSON.parse(text),
        };
        sent.push(recorded);
        const reply = answer(recorded);
        return Response.json(reply.body, { status: reply.status, headers: reply.headers ?? {} });
    };
    return { fetch, sent, posts: () => sent.filter((request) => request.method === 'POST') };
}

function synced(body: SentRequest['body'], id = CLOUD_CHAT): Reply {
    const next = (body?.from_index ?? 0) + (body?.messages.length ?? 0);
    return {
        status: 200,
        body: {
            id,
            next_index: next,
            object: 'synced_chat',
            redactions: {},
            status: body?.from_index === 0 ? 'created' : 'appended',
            url: `https://app.dexto.ai/chats/${id}`,
        },
    };
}

function refusal(
    status: number,
    code: string,
    details?: unknown,
    headers?: Record<string, string>
) {
    return {
        status,
        body: { error: { code, message: code, requestId: 'req', retryable: false, details } },
        ...(headers !== undefined && { headers }),
    };
}

function said(role: 'user' | 'assistant', text: string): InternalMessage {
    return role === 'user'
        ? { role, content: [{ type: 'text', text }], timestamp: 1 }
        : {
              role,
              content: [{ type: 'text', text }],
              assistantOutput: { status: 'complete' },
              timestamp: 1,
          };
}

let store: ChatSyncStore;
let chats: Map<string, LocalChat>;
let notes: string[];
let now: number;
let signedIn: boolean;
let scheduled: { at: number; chatId: string }[];

/** A local chat whose messages a test adds to. */
interface TestChat extends LocalChat {
    readonly messages: InternalMessage[];
}

function chat(id: string, count: number, cwd: string | null = '/work/app'): TestChat {
    const messages = Array.from({ length: count }, (_, index) =>
        said(index % 2 === 0 ? 'user' : 'assistant', `message ${index}`)
    );
    const local: TestChat = {
        id,
        cwd,
        gitBranch: 'main',
        title: `Chat ${id}`,
        messages,
        parentIds: [],
    };
    chats.set(id, local);
    return local;
}

function engine(server: ReturnType<typeof fakeServer>): ChatSync {
    const client = createCloudClient({
        apiBaseUrl: 'https://api.dexto.ai',
        token: 'token',
        cloudProject: null,
        fetch: server.fetch,
    });
    return createChatSync({
        store,
        connect: async () => (signedIn ? { client, account: ACCOUNT } : null),
        readChat: async (id) => chats.get(id) ?? null,
        note: (text) => notes.push(text),
        now: () => now,
        schedule: (ms, chatId) => scheduled.push({ at: now + ms, chatId }),
        machineName: 'laptop',
        cliVersion: '2.0.0',
    });
}

beforeEach(async () => {
    store = chatSyncStore(path.join(await mkdtemp(path.join(tmpdir(), 'chat-sync-')), 'sync'));
    await store.writeSettings({ ...(await store.readSettings()), noticeShownAt: 'shown' });
    chats = new Map();
    notes = [];
    now = Date.parse('2026-11-04T10:00:00.000Z');
    signedIn = true;
    scheduled = [];
});

describe('createChatSync', () => {
    it("creates the cloud chat, then sends only what is new, from the server's next index", async () => {
        const server = fakeServer((request) => synced(request.body));
        const sync = engine(server);
        const local = chat('s1', 2);

        await sync.sync('s1');
        local.messages.push(said('user', 'more'));
        await sync.sync('s1');
        await sync.sync('s1');

        expect(server.posts().map((request) => [request.path, request.body?.from_index])).toEqual([
            ['/v1/synced_chats', 0],
            ['/v1/synced_chats', 2],
        ]);
        expect(server.posts()[1]?.body?.messages.map((message) => message.index)).toEqual([2]);
        expect(server.posts()[0]?.body).toMatchObject({
            local_chat_id: 's1',
            title: 'Chat s1',
            cwd: '/work/app',
            git_branch: 'main',
            cli_version: '2.0.0',
            machine: { name: 'laptop' },
        });
    });

    it('sends nothing before the first-run notice was shown', async () => {
        await store.writeSettings({ ...(await store.readSettings()), noticeShownAt: null });
        const server = fakeServer((request) => synced(request.body));
        chat('s1', 2);

        await engine(server).sync('s1');

        expect(server.sent).toEqual([]);
    });

    it('sends nothing when sync is off, the folder opted out, or the chat is private', async () => {
        const server = fakeServer((request) => synced(request.body));
        const sync = engine(server);
        chat('everywhere', 1);
        chat('in-project', 1, '/work/secret/api');
        chat('private', 1);
        const settings = await store.readSettings();
        await store.writeSettings({
            ...settings,
            projectsOff: ['/work/secret'],
            privateChats: ['private'],
        });

        await sync.sync('in-project');
        await sync.sync('private');
        await store.writeSettings({ ...(await store.readSettings()), sync: 'off' });
        await sync.sync('everywhere');

        expect(server.sent).toEqual([]);
    });

    it('stops syncing once the person signs out', async () => {
        const server = fakeServer((request) => synced(request.body));
        const sync = engine(server);
        const local = chat('s1', 1);
        await sync.sync('s1');

        signedIn = false;
        local.messages.push(said('assistant', 'after logout'));
        await sync.sync('s1');

        expect(server.posts()).toHaveLength(1);
    });

    it('sends a long chat in batches of at most 200 messages', async () => {
        const server = fakeServer((request) => synced(request.body));
        chat('s1', 450);

        await engine(server).sync('s1');

        expect(server.posts().map((request) => request.body?.messages.length)).toEqual([
            200, 200, 50,
        ]);
        expect(server.posts().map((request) => request.body?.from_index)).toEqual([0, 200, 400]);
    });

    it('waits as long as a 429 says before sending anything again', async () => {
        let limited = true;
        const server = fakeServer((request) =>
            limited
                ? refusal(429, 'rate_limited', undefined, { 'retry-after': '60' })
                : synced(request.body)
        );
        const sync = engine(server);
        chat('s1', 1);
        chat('s2', 1);

        await sync.sync('s1');
        await sync.sync('s2');
        expect(server.posts()).toHaveLength(1);
        expect(scheduled).toContainEqual({ at: now + 60_000, chatId: 's1' });

        limited = false;
        now += 59_000;
        await sync.sync('s1');
        expect(server.posts()).toHaveLength(1);

        now += 1_000;
        await sync.sync('s1');
        await sync.sync('s2');
        expect(server.posts()).toHaveLength(3);
    });

    it('honours Retry-After on a 413 too', async () => {
        let tooLarge = true;
        const server = fakeServer((request) =>
            tooLarge
                ? refusal(413, 'payload_too_large', undefined, { 'retry-after': '30' })
                : synced(request.body)
        );
        const sync = engine(server);
        chat('s1', 1);

        await sync.sync('s1');
        tooLarge = false;
        await sync.sync('s1');
        expect(server.posts()).toHaveLength(1);

        now += 30_000;
        await sync.sync('s1');
        expect(server.posts()).toHaveLength(2);
    });

    it('sends a smaller batch after a 413, and stops a chat whose one message is still too large', async () => {
        const server = fakeServer((request) =>
            (request.body?.messages.length ?? 0) > 1 || request.body?.from_index === 2
                ? refusal(413, 'payload_too_large')
                : synced(request.body)
        );
        const sync = engine(server);
        const local = chat('s1', 3);

        await sync.sync('s1');
        local.messages.push(said('user', 'later'));
        await sync.sync('s1');

        // Halved until it fits, and kept that small for the rest of the run.
        expect(server.posts().map((request) => request.body?.messages.length)).toEqual([
            3, 2, 1, 1, 1,
        ]);
        expect(await store.readChat(ACCOUNT, 's1')).toMatchObject({
            status: 'stopped',
            reason: 'chat_full',
        });
        expect(notes.join('\n')).toMatch(/"Chat s1" stopped syncing/u);
    });

    it('stops a chat for good on sync_diverged', async () => {
        const server = fakeServer(() => refusal(409, 'sync_diverged', { index: 0 }));
        const sync = engine(server);
        const local = chat('s1', 1);

        await sync.sync('s1');
        local.messages.push(said('assistant', 'more'));
        now += 24 * 60 * 60_000;
        await sync.sync('s1');

        expect(server.posts()).toHaveLength(1);
        expect(await store.readChat(ACCOUNT, 's1')).toMatchObject({
            status: 'stopped',
            reason: 'sync_diverged',
        });
    });

    it('pauses a chat that continues in the cloud or is moving, and resumes once it is back', async () => {
        for (const code of ['chat_in_cloud', 'move_in_progress']) {
            let away = true;
            const server = fakeServer((request) =>
                away ? refusal(409, code) : synced(request.body)
            );
            const sync = engine(server);
            chat(`s-${code}`, 1);

            await sync.sync(`s-${code}`);
            await sync.sync(`s-${code}`);
            expect(server.posts()).toHaveLength(1);
            expect(await store.readChat(ACCOUNT, `s-${code}`)).toMatchObject({
                status: 'paused',
                reason: code,
            });

            away = false;
            now += 5 * 60_000;
            await sync.sync(`s-${code}`);
            expect(server.posts()).toHaveLength(2);
            expect(await store.readChat(ACCOUNT, `s-${code}`)).toMatchObject({ status: 'syncing' });
        }
    });

    it("resends from the server's next index after sync_gap", async () => {
        let gap = true;
        const server = fakeServer((request) => {
            if (gap && request.body?.from_index === 2) {
                gap = false;
                return refusal(409, 'sync_gap', { next_index: 1 });
            }
            return synced(request.body);
        });
        const sync = engine(server);
        const local = chat('s1', 2);
        await sync.sync('s1');

        local.messages.push(said('user', 'third'));
        await sync.sync('s1');

        expect(server.posts().map((request) => request.body?.from_index)).toEqual([0, 2, 1]);
        expect(server.posts()[2]?.body?.messages.map((message) => message.index)).toEqual([1, 2]);
    });

    it('explains the synced chat limit once, holds back new chats, and keeps syncing synced ones', async () => {
        let full = true;
        const server = fakeServer((request) =>
            full && request.body?.from_index === 0 && request.body.local_chat_id !== 'old'
                ? refusal(409, 'synced_chat_limit')
                : synced(
                      request.body,
                      request.body?.local_chat_id === 'old' ? OTHER_CLOUD_CHAT : CLOUD_CHAT
                  )
        );
        const sync = engine(server);
        const old = chat('old', 1);
        await sync.sync('old');
        chat('new-1', 1);
        chat('new-2', 1);

        await sync.sync('new-1');
        await sync.sync('new-2');
        old.messages.push(said('assistant', 'still syncing'));
        await sync.sync('old');

        expect(server.posts().map((request) => request.body?.local_chat_id)).toEqual([
            'old',
            'new-1',
            'old',
        ]);
        expect(notes.filter((note) => /1,000/u.test(note))).toHaveLength(1);
        expect(notes.join('\n')).toMatch(/[Dd]elet/u);

        full = false;
        now += 60 * 60_000;
        await sync.sync('new-2');
        expect(server.posts().at(-1)?.body?.local_chat_id).toBe('new-2');
    });

    it('tries new chats again as soon as deleting a synced chat makes room', async () => {
        let full = true;
        const server = fakeServer((request) => {
            if (request.method === 'DELETE') {
                full = false;
                return {
                    status: 200,
                    body: { deleted: true, id: CLOUD_CHAT, object: 'synced_chat' },
                };
            }
            return full && request.body?.local_chat_id === 'new'
                ? refusal(409, 'synced_chat_limit')
                : synced(request.body);
        });
        const sync = engine(server);
        chat('old', 1);
        await sync.sync('old');
        chat('new', 1);
        await sync.sync('new');

        await sync.deleteLocalChat('old');
        await sync.sync('new');

        expect(server.posts().map((request) => request.body?.local_chat_id)).toEqual([
            'old',
            'new',
            'new',
        ]);
    });

    it('asks to sign in again once when the token lacks chats:sync', async () => {
        const server = fakeServer(() => refusal(403, 'forbidden', { scope: 'chats:sync' }));
        const sync = engine(server);
        chat('s1', 1);
        chat('s2', 1);

        await sync.sync('s1');
        await sync.sync('s2');

        expect(server.posts()).toHaveLength(1);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatch(/dexto login/u);
    });

    it('retries after a network failure, later each time', async () => {
        let down = true;
        const server = fakeServer((request) => {
            if (down) throw new TypeError('fetch failed');
            return synced(request.body);
        });
        const sync = engine(server);
        chat('s1', 1);

        await sync.sync('s1');
        await sync.sync('s1');
        expect(server.sent).toHaveLength(1);

        down = false;
        now += 30_000;
        await sync.sync('s1');
        expect(server.posts()).toHaveLength(2);
        expect(await store.readChat(ACCOUNT, 's1')).toMatchObject({ nextIndex: 1 });
    });
});

describe('deleting and making a chat private', () => {
    it('deletes the cloud copy when the local chat is deleted', async () => {
        const server = fakeServer((request) =>
            request.method === 'DELETE'
                ? { status: 200, body: { deleted: true, id: CLOUD_CHAT, object: 'synced_chat' } }
                : synced(request.body)
        );
        const sync = engine(server);
        chat('s1', 1);
        await sync.sync('s1');

        await sync.deleteLocalChat('s1');

        expect(server.sent.at(-1)).toMatchObject({
            method: 'DELETE',
            path: `/v1/synced_chats/${CLOUD_CHAT}`,
        });
        expect(await store.readChat(ACCOUNT, 's1')).toBeNull();
    });

    it('makes a chat private: deletes its cloud copy and never syncs it again', async () => {
        const server = fakeServer((request) =>
            request.method === 'DELETE'
                ? { status: 200, body: { deleted: true, id: CLOUD_CHAT, object: 'synced_chat' } }
                : synced(request.body)
        );
        const sync = engine(server);
        const local = chat('s1', 1);
        await sync.sync('s1');

        await sync.makePrivate('s1');
        local.messages.push(said('user', 'secret plans'));
        await sync.sync('s1');

        expect(server.sent.map((request) => request.method)).toEqual(['POST', 'DELETE']);
        expect((await store.readSettings()).privateChats).toEqual(['s1']);
    });

    it('keeps a delete it could not send, and sends it once it can', async () => {
        let down = true;
        const server = fakeServer((request) => {
            if (request.method === 'DELETE' && down) throw new TypeError('fetch failed');
            return request.method === 'DELETE'
                ? { status: 404, body: { error: { code: 'not_found', message: 'gone' } } }
                : synced(request.body);
        });
        const sync = engine(server);
        chat('s1', 1);
        await sync.sync('s1');

        await sync.deleteLocalChat('s1');
        expect((await store.readAccount(ACCOUNT)).pendingDeletes).toEqual([CLOUD_CHAT]);

        down = false;
        await sync.sendPendingDeletes();
        expect((await store.readAccount(ACCOUNT)).pendingDeletes).toEqual([]);
    });

    it('says when a chat that continues in the cloud was not deleted', async () => {
        const server = fakeServer((request) =>
            request.method === 'DELETE' ? refusal(409, 'chat_in_cloud') : synced(request.body)
        );
        const sync = engine(server);
        chat('s1', 1);
        await sync.sync('s1');

        expect(await sync.deleteLocalChat('s1')).toBe('in_cloud');
        expect((await store.readAccount(ACCOUNT)).pendingDeletes).toEqual([]);
    });

    it('keeps a delete added while other deletes were being sent', async () => {
        let releaseFirst: () => void = () => undefined;
        const firstDelete = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let deletes = 0;
        const server = fakeServer((request) => {
            if (request.method !== 'DELETE')
                return synced(
                    request.body,
                    request.body?.local_chat_id === 'a' ? CLOUD_CHAT : OTHER_CLOUD_CHAT
                );
            deletes += 1;
            return deletes === 1
                ? { status: 200, body: { deleted: true, id: CLOUD_CHAT, object: 'synced_chat' } }
                : refusal(429, 'rate_limited', undefined, { 'retry-after': '1' });
        });
        const slowFetch = server.fetch;
        server.fetch = async (input, init) => {
            const request =
                input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
            if (request.method === 'DELETE' && deletes === 0) await firstDelete;
            return slowFetch(request);
        };
        const sync = engine(server);
        chat('a', 1);
        chat('b', 1);
        await sync.sync('a');
        await sync.sync('b');

        const deletingA = sync.deleteLocalChat('a');
        const deletingB = sync.makePrivate('b');
        releaseFirst();
        await Promise.all([deletingA, deletingB]);

        expect((await store.readAccount(ACCOUNT)).pendingDeletes).toEqual([OTHER_CLOUD_CHAT]);
    });

    it('deletes after an open move ends', async () => {
        let moving = true;
        const server = fakeServer((request) => {
            if (request.method !== 'DELETE') return synced(request.body);
            return moving
                ? refusal(409, 'move_in_progress', { move_id: 'm1' })
                : { status: 200, body: { deleted: true, id: CLOUD_CHAT, object: 'synced_chat' } };
        });
        const sync = engine(server);
        chat('s1', 1);
        await sync.sync('s1');

        await sync.deleteLocalChat('s1');
        expect((await store.readAccount(ACCOUNT)).pendingDeletes).toEqual([CLOUD_CHAT]);
        moving = false;
        await sync.sendPendingDeletes();

        expect((await store.readAccount(ACCOUNT)).pendingDeletes).toEqual([]);
    });

    it('never syncs a chat forked from a private chat', async () => {
        const server = fakeServer((request) => synced(request.body));
        const sync = engine(server);
        await store.writeSettings({ ...(await store.readSettings()), privateChats: ['parent'] });
        chats.set('fork', { ...chat('fork', 2), parentIds: ['parent'] });

        await sync.sync('fork');

        expect(server.sent).toEqual([]);
    });
});

describe('opting out while a chat syncs', () => {
    it('stops before the next batch when sync is turned off', async () => {
        const server = fakeServer((request) => synced(request.body));
        const answer = server.fetch;
        // The person turns sync off while the first batch is on its way.
        server.fetch = async (input, init) => {
            const response = await answer(input, init);
            await store.writeSettings({ ...(await store.readSettings()), sync: 'off' });
            return response;
        };
        const sync = engine(server);
        chat('s1', 450);

        await sync.sync('s1');

        expect(server.posts()).toHaveLength(1);
    });

    it('asks a refused sign-in again after a while, not on every run', async () => {
        let refuse = true;
        const server = fakeServer((request) =>
            refuse ? refusal(401, 'unauthorized') : synced(request.body)
        );
        const sync = engine(server);
        chat('s1', 1);

        await sync.sync('s1');
        await sync.sync('s1');
        expect(server.posts()).toHaveLength(1);

        refuse = false;
        now += 15 * 60_000;
        await sync.sync('s1');
        expect(server.posts()).toHaveLength(2);
    });
});
