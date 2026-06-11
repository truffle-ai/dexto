import { describe, expect, it } from 'vitest';
import type { InternalMessage } from '../../context/types.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import { createInMemoryDatabase } from '../../test-utils/in-memory-storage.js';
import { StorageErrorCode } from '../error-codes.js';
import { DatabaseConversationStore } from './database.js';

describe('DatabaseConversationStore', () => {
    it('persists session messages through the conversation store contract', async () => {
        const database = createInMemoryDatabase();
        const store = new DatabaseConversationStore(database, createMockLogger());
        await database.connect();

        const userMessage: InternalMessage = {
            id: 'message-1',
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
            timestamp: 1,
        };
        const assistantMessage: InternalMessage = {
            id: 'message-2',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            timestamp: 2,
        };

        await store.saveMessage({ sessionId: 'session-1', message: userMessage });
        await store.saveMessage({ sessionId: 'session-1', message: assistantMessage });

        expect(await store.listMessages({ sessionId: 'session-1' })).toEqual([
            userMessage,
            assistantMessage,
        ]);
    });

    it('flushes message updates back to durable storage', async () => {
        const database = createInMemoryDatabase();
        const store = new DatabaseConversationStore(database, createMockLogger());
        await database.connect();

        await store.saveMessage({
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                role: 'assistant',
                content: [{ type: 'text', text: 'draft' }],
                timestamp: 1,
            },
        });
        await store.updateMessage({
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                role: 'assistant',
                content: [{ type: 'text', text: 'final' }],
                timestamp: 1,
            },
        });
        await store.flush({ sessionId: 'session-1' });

        expect(await database.getRange<InternalMessage>('messages:session-1', 0, 10)).toEqual([
            {
                id: 'message-1',
                role: 'assistant',
                content: [{ type: 'text', text: 'final' }],
                timestamp: 1,
            },
        ]);
    });

    it('maps storage load failures to storage errors', async () => {
        const store = new DatabaseConversationStore(
            {
                get: async () => undefined,
                set: async () => {},
                setIfAbsent: async <T>(_key: string, value: T) => ({
                    value,
                    inserted: true,
                }),
                delete: async () => {},
                list: async () => [],
                append: async () => {},
                updateList: async () => {
                    throw new Error('not implemented');
                },
                getRange: async () => {
                    throw new Error('read failed');
                },
                connect: async () => {},
                disconnect: async () => {},
                isConnected: () => true,
                getStoreType: () => 'failing',
            },
            createMockLogger()
        );

        await expect(store.listMessages({ sessionId: 'session-1' })).rejects.toMatchObject({
            code: StorageErrorCode.READ_FAILED,
            scope: ErrorScope.STORAGE,
            type: ErrorType.SYSTEM,
        });
    });
});
