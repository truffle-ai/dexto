import { describe, expect, it } from 'vitest';
import { faultBlock } from './fault-block.js';

describe('faultBlock', () => {
    it('takes the title without its "Error:" prefix', () => {
        expect(faultBlock('Error: Model rate limit')).toEqual({
            title: 'Model rate limit',
            body: [],
            next: [],
        });
    });

    it('separates further lines from recovery steps', () => {
        const block = faultBlock(
            'Error: Cloud unreachable\ntimed out\n\n💡 Check your connection\n💡 Try /status'
        );
        expect(block.title).toBe('Cloud unreachable');
        expect(block.body).toEqual(['timed out']);
        expect(block.next).toEqual(['Check your connection', 'Try /status']);
    });

    it('still has a title when the error is empty', () => {
        expect(faultBlock('Error: ').title).toBe('Something went wrong');
    });
});
