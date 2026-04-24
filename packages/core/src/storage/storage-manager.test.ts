import { describe, expect, it } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import {
    createInMemoryBlobStore,
    createInMemoryCache,
    createInMemoryDatabase,
} from '../test-utils/in-memory-storage.js';
import { StorageManager } from './storage-manager.js';

describe('StorageManager', () => {
    it('exposes typed stores while retaining low-level backend access during migration', async () => {
        const manager = new StorageManager(
            {
                cache: createInMemoryCache(),
                database: createInMemoryDatabase(),
                blobStore: createInMemoryBlobStore(),
            },
            createMockLogger()
        );

        await manager.connect();

        await manager.getStore('conversation').saveMessage({
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
                timestamp: 1,
            },
        });

        expect(await manager.getDatabase().getRange('messages:session-1', 0, 10)).toHaveLength(1);
        expect(manager.getStore('cache')).toBeDefined();
        expect(manager.getStore('artifacts')).toBeDefined();

        await manager.disconnect();
        expect(manager.isConnected()).toBe(false);
    });
});
