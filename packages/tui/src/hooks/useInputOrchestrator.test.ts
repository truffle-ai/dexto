import { describe, expect, it } from 'vitest';
import type { Message } from '../state/types.js';
import { stoppedTranscript } from './useInputOrchestrator.js';

function message(overrides: Partial<Message>): Message {
    return { id: 'm', role: 'tool', content: '', timestamp: new Date(0), ...overrides };
}

const MARKER = message({ id: 'stop', role: 'system', systemKind: 'stopped' });

describe('stoppedTranscript', () => {
    it('puts the marker below the stopped tool row', () => {
        const running = message({ id: 'tool-1', toolStatus: 'running' });
        const added = stoppedTranscript([running], MARKER);
        expect(added.map((each) => each.id)).toEqual(['tool-1', 'stop']);
        expect(added[0]).toMatchObject({
            toolStatus: 'finished',
            toolOutcome: 'cancelled',
            isError: true,
        });
    });

    it('leaves other pending messages alone, and still marks a stop with nothing pending', () => {
        const text = message({ id: 'a', role: 'assistant', content: 'hi' });
        expect(stoppedTranscript([text], MARKER)).toEqual([text, MARKER]);
        expect(stoppedTranscript([], MARKER)).toEqual([MARKER]);
    });
});
