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

        await storage.getStore('messageQueue').save({
            sessionId: 'session-1',
            queue: [
                {
                    id: 'queued-1',
                    content: [{ type: 'text', text: 'next' }],
                    queuedAt: 2,
                },
            ],
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
        expect(await storage.getStore('messageQueue').load({ sessionId: 'session-1' })).toEqual([
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
});
