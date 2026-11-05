import { AgentEventBus } from '@dexto/core';
import { describe, expect, it } from 'vitest';
import { deleteCloudCopiesWithChats } from './node.js';

describe('deleteCloudCopiesWithChats', () => {
    it("deletes a chat's cloud copy when the agent deletes the chat", async () => {
        const bus = new AgentEventBus();
        const deleted: string[] = [];
        deleteCloudCopiesWithChats(
            { on: (name, listener) => bus.on(name, listener) },
            {
                deleteLocalChat: async (id) => {
                    deleted.push(id);
                    return 'deleted';
                },
            }
        );

        bus.emit('session:deleted', { sessionId: 'chat-1' });
        await Promise.resolve();

        expect(deleted).toEqual(['chat-1']);
    });
});
