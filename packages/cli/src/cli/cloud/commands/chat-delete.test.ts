import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import type { CommandContext, CommandInput } from '../command.js';
import { chatDeleteCommand } from './chat-delete.js';

const query = vi.hoisted(() => vi.fn());
const scopes = vi.hoisted(() => vi.fn());
const deleteSyncedCopy = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));
vi.mock('./deploys.js', () => ({ requireLoginScopes: scopes }));
vi.mock('../../chat-sync/node.js', () => ({
    nodeChatSync: () => ({ deleteLocalChat: deleteSyncedCopy }),
}));

function harness(openLocalAgent?: () => Promise<unknown>) {
    const result = vi.fn();
    const context = {
        invocation: ['chat', 'delete'],
        runtime: { prompt: null },
        output: { json: true, result },
        ...(openLocalAgent === undefined ? {} : { openLocalAgent }),
    } as unknown as CommandContext;
    return { context, result };
}

function input(positionals: string[], values: CommandInput['values'] = {}): CommandInput {
    return { positionals, values };
}

function localAgent(ids: string[]) {
    return {
        getSessionMetadata: async (id: string) =>
            ids.includes(id) ? { lastActivity: 1, messageCount: 1 } : undefined,
        deleteSession: vi.fn(async () => undefined),
    };
}

beforeEach(() => {
    query.mockReset();
    scopes.mockReset();
    deleteSyncedCopy.mockReset();
});

describe('chat delete', () => {
    it('deletes a cloud chat over dexto_chat_delete, without the local agent', async () => {
        const openLocalAgent = vi.fn();
        const { context, result } = harness(openLocalAgent);
        query.mockResolvedValueOnce({ deleted: true, sessionId: 'chat-1' });
        await chatDeleteCommand.run(context, input(['chat-1'], { yes: true }));
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:write']);
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_delete', { sessionId: 'chat-1' });
        expect(openLocalAgent).not.toHaveBeenCalled();
        expect(result).toHaveBeenCalledWith(
            { deleted: true, sessionId: 'chat-1' },
            'Deleted chat chat-1.'
        );
    });

    it('asks first: without --yes and no terminal it stops with exit 4', async () => {
        await expect(
            chatDeleteCommand.run(harness().context, input(['chat-1']))
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(query).not.toHaveBeenCalled();
    });

    it('shows the call with --dry-run and makes none', async () => {
        const { context, result } = harness();
        await chatDeleteCommand.run(context, input(['chat-1'], { 'dry-run': true }));
        expect(query).not.toHaveBeenCalled();
        expect(result).toHaveBeenCalledWith(
            { dryRun: true, tool: 'dexto_chat_delete', arguments: { sessionId: 'chat-1' } },
            expect.any(String)
        );
    });

    it('points a chat Dexto does not have to --local', async () => {
        query.mockRejectedValueOnce(
            new CommandFailure('not_found', 'Dexto session was not found.', null)
        );
        await expect(
            chatDeleteCommand.run(harness().context, input(['local-1'], { yes: true }))
        ).rejects.toMatchObject({
            kind: 'not_found',
            fix: 'dexto chat delete local-1 --local',
        });
    });

    it('deletes a chat on this machine and its synced copy with --local', async () => {
        const agent = localAgent(['local-1']);
        const { context, result } = harness(async () => agent);
        deleteSyncedCopy.mockResolvedValueOnce('deleted');
        await chatDeleteCommand.run(context, input(['local-1'], { local: true, yes: true }));
        expect(query).not.toHaveBeenCalled();
        expect(agent.deleteSession).toHaveBeenCalledWith('local-1');
        expect(deleteSyncedCopy).toHaveBeenCalledWith('local-1');
        expect(result).toHaveBeenCalledWith(
            { deleted: true, sessionId: 'local-1', syncedCopy: 'deleted' },
            'Deleted chat local-1 on this machine.\nIts synced copy in Dexto Cloud is deleted too.'
        );
    });

    it('says a synced copy it could not reach yet is pending', async () => {
        const { context, result } = harness(async () => localAgent(['local-1']));
        deleteSyncedCopy.mockRejectedValueOnce(new Error('offline'));
        await chatDeleteCommand.run(context, input(['local-1'], { local: true, yes: true }));
        expect(result.mock.calls[0]?.[0]).toMatchObject({ syncedCopy: 'pending' });
    });

    it('points an id this machine does not have to the cloud chat', async () => {
        const agent = localAgent([]);
        await expect(
            chatDeleteCommand.run(
                harness(async () => agent).context,
                input(['chat-1'], { local: true, yes: true })
            )
        ).rejects.toMatchObject({ kind: 'not_found', fix: 'dexto chat delete chat-1' });
        expect(agent.deleteSession).not.toHaveBeenCalled();
    });
});
