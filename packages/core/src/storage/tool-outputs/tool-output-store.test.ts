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
