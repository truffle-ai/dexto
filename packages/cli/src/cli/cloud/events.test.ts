import { describe, expect, it } from 'vitest';
import { parseEventBlock } from './events.js';

describe('parseEventBlock', () => {
    it('reads an event from its data lines, joined', () => {
        expect(
            parseEventBlock(
                'id: 7\nevent: message\ndata: {"type":"message.delta",\ndata: "run_id":"r1","text":"hi"}'
            )
        ).toEqual({ type: 'message.delta', run_id: 'r1', text: 'hi' });
    });

    it('skips comments, blocks without data, unknown events and bad JSON', () => {
        expect(parseEventBlock(': keep-alive')).toBeNull();
        expect(parseEventBlock('data: {"type":"something.new","run_id":"r1"}')).toBeNull();
        expect(parseEventBlock('data: {not json')).toBeNull();
    });
});
