import { describe, expect, it } from 'vitest';
import { InMemoryDextoStores } from './in-memory.js';

describe('InMemoryDextoStores', () => {
    it('returns typed runtime stores through one connected composite store', async () => {
        const storage = new InMemoryDextoStores();

        expect(storage.isConnected()).toBe(false);
        await storage.connect();
        expect(storage.isConnected()).toBe(true);

        const conversation = storage.getStore('conversation');
        await conversation.saveMessage({
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
                timestamp: 1,
            },
        });

        await storage.getStore('steerQueue').append({
            sessionId: 'session-1',
            message: {
                id: 'queued-1',
                content: [{ type: 'text', text: 'next' }],
                queuedAt: 2,
            },
        });

        await storage.getStore('toolPreferences').allowTool({
            sessionId: 'session-1',
            toolName: 'todo_write',
        });

        expect(await conversation.listMessages({ sessionId: 'session-1' })).toEqual([
            {
                id: 'message-1',
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
                timestamp: 1,
            },
        ]);
        expect(await storage.getStore('steerQueue').list({ sessionId: 'session-1' })).toEqual([
            {
                id: 'queued-1',
                content: [{ type: 'text', text: 'next' }],
                queuedAt: 2,
            },
        ]);
        expect(
            await storage.getStore('toolPreferences').isToolAllowed({
                sessionId: 'session-1',
                toolName: 'todo_write',
            })
        ).toBe(true);

        await storage.disconnect();
        expect(storage.isConnected()).toBe(false);
    });

    it('preserves message queue append order instead of sorting by queuedAt', async () => {
        const storage = new InMemoryDextoStores();
        const steerQueue = storage.getStore('steerQueue');

        await steerQueue.append({
            sessionId: 'session-append-order',
            message: {
                id: 'queued-later-timestamp',
                content: [{ type: 'text', text: 'first append' }],
                queuedAt: 2,
            },
        });
        await steerQueue.append({
            sessionId: 'session-append-order',
            message: {
                id: 'queued-earlier-timestamp',
                content: [{ type: 'text', text: 'second append' }],
                queuedAt: 1,
            },
        });

        expect(
            (await steerQueue.list({ sessionId: 'session-append-order' })).map(
                (message) => message.id
            )
        ).toEqual(['queued-later-timestamp', 'queued-earlier-timestamp']);
    });
});

describe('InMemoryDextoStores message queue takeAll', () => {
    it('leaves excluded ids in place and takes the rest in order', async () => {
        const storage = new InMemoryDextoStores();
        const followUpQueue = storage.getStore('followUpQueue');
        for (const id of ['keep-1', 'take-1', 'take-2']) {
            await followUpQueue.append({
                sessionId: 'session-1',
                message: { id, content: [{ type: 'text', text: id }], queuedAt: 1 },
            });
        }

        const taken = await followUpQueue.takeAll({
            sessionId: 'session-1',
            excludeIds: ['keep-1'],
        });

        expect(taken.map((message) => message.id)).toEqual(['take-1', 'take-2']);
        expect(
            (await followUpQueue.list({ sessionId: 'session-1' })).map((message) => message.id)
        ).toEqual(['keep-1']);

        expect(await followUpQueue.takeAll({ sessionId: 'session-1' })).toHaveLength(1);
        expect(await followUpQueue.list({ sessionId: 'session-1' })).toEqual([]);
    });
});
