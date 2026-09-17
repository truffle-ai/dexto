import { describe, expect, it, vi } from 'vitest';
import type { QueuedMessage, RestoredPendingInput } from '@dexto/core';
import { queueCommand, formatRestoredPendingInput } from './queue-commands.js';
import { isSendMessageMarker } from '../services/CommandService.js';

function queued(id: string, text: string): QueuedMessage {
    return { id, content: [{ type: 'text', text }], queuedAt: 1 };
}

function createAgent(pending: RestoredPendingInput) {
    return {
        getRestoredPendingInput: vi.fn().mockResolvedValue(pending),
        takeRestoredPendingInput: vi.fn().mockResolvedValue(
            pending.steer.length + pending.followUp.length === 0
                ? null
                : {
                      messages: [...pending.steer, ...pending.followUp],
                      combinedContent: [
                          { type: 'text', text: 'combined restored input' },
                          { type: 'image', image: 'aGVsbG8=', mimeType: 'image/png' },
                      ],
                      firstQueuedAt: 1,
                      lastQueuedAt: 1,
                  }
        ),
        discardRestoredPendingInput: vi
            .fn()
            .mockResolvedValue(pending.steer.length + pending.followUp.length),
        logger: { debug: vi.fn(), error: vi.fn() },
    };
}

const ctx = { sessionId: 'session-1', configFilePath: null };

describe('/queue', () => {
    it('refuses to act without an active session', async () => {
        const agent = createAgent({ steer: [], followUp: [] });
        const result = await queueCommand.handler([], agent as never, {
            sessionId: null,
            configFilePath: null,
        });
        expect(result).toContain('No active session');
        expect(agent.getRestoredPendingInput).not.toHaveBeenCalled();
    });

    it('lists restored input on hold with the resume/discard hint', async () => {
        const agent = createAgent({
            steer: [queued('s1', 'now about de gea')],
            followUp: [queued('f1', 'then summarize the season')],
        });
        const result = await queueCommand.handler([], agent as never, ctx);
        expect(typeof result).toBe('string');
        expect(result).toContain('2 queued messages from an interrupted run are on hold');
        expect(result).toContain('now about de gea');
        expect(result).toContain('then summarize the season');
        expect(result).toContain('/queue resume');
        expect(result).toContain('/queue discard');
    });

    it('reports when nothing is on hold', async () => {
        const agent = createAgent({ steer: [], followUp: [] });
        expect(await queueCommand.handler(['status'], agent as never, ctx)).toContain(
            'No queued input is waiting'
        );
        expect(await queueCommand.handler(['resume'], agent as never, ctx)).toContain(
            'No queued input is waiting'
        );
        expect(await queueCommand.handler(['discard'], agent as never, ctx)).toContain(
            'No queued input is waiting'
        );
    });

    it('resume takes the restored input and sends it through the normal message flow', async () => {
        const agent = createAgent({ steer: [queued('s1', 'now about de gea')], followUp: [] });
        const result = await queueCommand.handler(['resume'], agent as never, ctx);

        expect(agent.takeRestoredPendingInput).toHaveBeenCalledWith('session-1');
        expect(isSendMessageMarker(result)).toBe(true);
        if (!isSendMessageMarker(result)) {
            throw new Error('expected a send marker');
        }
        // Structured content is carried through so attachments survive the resume.
        expect(result.content).toEqual([
            { type: 'text', text: 'combined restored input' },
            { type: 'image', image: 'aGVsbG8=', mimeType: 'image/png' },
        ]);
        expect(result.text).toBe('combined restored input');
    });

    it('discard drops the restored input and reports the count', async () => {
        const agent = createAgent({
            steer: [queued('s1', 'a')],
            followUp: [queued('f1', 'b')],
        });
        const result = await queueCommand.handler(['discard'], agent as never, ctx);
        expect(agent.discardRestoredPendingInput).toHaveBeenCalledWith('session-1');
        expect(result).toContain('Discarded 2 queued messages');
    });

    it('rejects unknown actions with usage', async () => {
        const agent = createAgent({ steer: [], followUp: [] });
        const result = await queueCommand.handler(['bogus'], agent as never, ctx);
        expect(result).toContain('Unknown /queue action');
        expect(result).toContain('/queue [resume|discard]');
    });
});

describe('formatRestoredPendingInput', () => {
    it('uses singular wording for one entry', () => {
        const text = formatRestoredPendingInput({ steer: [], followUp: [queued('f1', 'x')] });
        expect(text).toContain('1 queued message from an interrupted run is on hold');
        expect(text).toContain('(follow-up) x');
    });
});
