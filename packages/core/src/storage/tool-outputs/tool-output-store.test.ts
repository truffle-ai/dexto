import { describe, expect, it } from 'vitest';
import { InMemoryToolOutputStore } from '../stores/in-memory.js';
import { DatabaseBackedToolOutputStore } from '../stores/backend.js';
import { createInMemoryDatabase } from '../../test-utils/in-memory-storage.js';
import type { ToolOutputStore } from './types.js';

const stores: Array<[string, () => Promise<ToolOutputStore>]> = [
    ['in-memory', async () => new InMemoryToolOutputStore()],
    [
        'database-backed',
        async () => {
            const database = createInMemoryDatabase();
            await database.connect();
            return new DatabaseBackedToolOutputStore(database);
        },
    ],
];

describe.each(stores)('%s ToolOutputStore', (_name, createStore) => {
    it('scopes outputs to their session and deletes one session at a time', async () => {
        const store = await createStore();
        await store.save({ sessionId: 's1', toolCallId: 'call-1', text: 'one' });
        await store.save({ sessionId: 's2', toolCallId: 'call-1', text: 'two' });

        expect(await store.load({ sessionId: 's1', toolCallId: 'call-1' })).toBe('one');
        expect(await store.load({ sessionId: 's3', toolCallId: 'call-1' })).toBeUndefined();

        await store.deleteSession({ sessionId: 's1' });

        expect(await store.load({ sessionId: 's1', toolCallId: 'call-1' })).toBeUndefined();
        expect(await store.load({ sessionId: 's2', toolCallId: 'call-1' })).toBe('two');
    });
});

describe('DatabaseBackedToolOutputStore session keys', () => {
    it('never deletes another session whose id shares a prefix or wildcard characters', async () => {
        const database = createInMemoryDatabase();
        await database.connect();
        const store = new DatabaseBackedToolOutputStore(database);
        await store.save({ sessionId: 'a', toolCallId: 'b:call', text: 'kept-1' });
        await store.save({ sessionId: 'a:b', toolCallId: 'call', text: 'kept-2' });
        await store.save({ sessionId: 's_1', toolCallId: 'call', text: 'deleted' });
        await store.save({ sessionId: 'sx1', toolCallId: 'call', text: 'kept-3' });

        await store.deleteSession({ sessionId: 's_1' });
        await store.deleteSession({ sessionId: 'a:b' });

        expect(await store.load({ sessionId: 'a', toolCallId: 'b:call' })).toBe('kept-1');
        expect(await store.load({ sessionId: 'a:b', toolCallId: 'call' })).toBeUndefined();
        expect(await store.load({ sessionId: 's_1', toolCallId: 'call' })).toBeUndefined();
        expect(await store.load({ sessionId: 'sx1', toolCallId: 'call' })).toBe('kept-3');
    });
});
