import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../command.js';
import { chatOutputsCommand } from './chat-outputs.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));
vi.mock('./deploys.js', () => ({ requireLoginScopes: vi.fn() }));

describe('chat outputs', () => {
    it('passes pagination to the chat outputs tool and returns its next cursor', async () => {
        const list = vi.fn();
        const context = { output: { list } } as unknown as CommandContext;
        const output = {
            id: 'a1',
            name: 'image.png',
            kind: 'file',
            reference: 'a1',
            mimeType: 'image/png',
            sizeBytes: 12,
            createdAt: '2026-11-01T00:00:00Z',
            url: '/file',
        };
        query.mockResolvedValueOnce({
            outputs: [output],
            nextCursor: 'next',
            untrustedContent: true,
        });
        await chatOutputsCommand.run(context, {
            positionals: ['s'],
            values: { limit: '2', after: 'cursor' },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_outputs_list', {
            sessionId: 's',
            limit: 2,
            cursor: 'cursor',
        });
        expect(list).toHaveBeenCalledWith(
            { data: [output], has_more: true, next_after: 'next' },
            expect.any(Array)
        );
    });
    it('returns an empty final page and rejects out-of-range limits locally', async () => {
        const list = vi.fn();
        const context = { output: { list } } as unknown as CommandContext;
        query.mockResolvedValueOnce({ outputs: [], nextCursor: null });
        await chatOutputsCommand.run(context, { positionals: ['s'], values: {} });
        expect(list).toHaveBeenCalledWith(
            { data: [], has_more: false, next_after: null },
            expect.any(Array)
        );
        await expect(
            chatOutputsCommand.run(context, { positionals: ['s'], values: { limit: '101' } })
        ).rejects.toThrow('--limit must be between 1 and 100');
    });
});
