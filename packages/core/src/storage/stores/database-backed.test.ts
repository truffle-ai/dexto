import { describe, expect, it } from 'vitest';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import {
    createInMemoryBlobStore,
    createInMemoryCache,
    createInMemoryDatabase,
} from '../../test-utils/in-memory-storage.js';
import { DatabaseBackedDextoStores } from './database-backed.js';

describe('DatabaseBackedDextoStores', () => {
    it('adapts existing database, cache, and blob backends into typed stores', async () => {
        const database = createInMemoryDatabase();
        const cache = createInMemoryCache();
        const blobStore = createInMemoryBlobStore();
        const stores = new DatabaseBackedDextoStores(
            { cache, database, blobStore },
            createMockLogger()
        );

        await stores.connect();
        expect(stores.isConnected()).toBe(true);

        await stores.getStore('conversation').saveMessage({
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
                timestamp: 1,
            },
        });
        await stores.getStore('messageQueue').save({
            sessionId: 'session-1',
            queue: [
                {
                    id: 'queued-1',
                    content: [{ type: 'text', text: 'next' }],
                    queuedAt: 2,
                },
            ],
        });
        await stores.getStore('toolPreferences').allowTool({
            sessionId: 'session-1',
            toolName: 'todo_write',
        });
        await stores.getStore('cache').set({ key: 'cache-key', value: 'cache-value' });
        const artifact = await stores.getStore('artifacts').store({
            data: Buffer.from('artifact'),
            metadata: { mimeType: 'text/plain' },
        });

        expect(await database.getRange('messages:session-1', 0, 10)).toHaveLength(1);
        expect(await cache.get('cache-key')).toBe('cache-value');
        expect(await stores.getStore('messageQueue').load({ sessionId: 'session-1' })).toEqual([
            {
                id: 'queued-1',
                content: [{ type: 'text', text: 'next' }],
                queuedAt: 2,
            },
        ]);
        expect(
            await stores.getStore('toolPreferences').isToolAllowed({
                sessionId: 'session-1',
                toolName: 'todo_write',
            })
        ).toBe(true);
        expect(await blobStore.exists(artifact.uri)).toBe(true);

        await stores.disconnect();
        expect(stores.isConnected()).toBe(false);
    });
});
