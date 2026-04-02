import { describe, expect, it } from 'vitest';
import { mergeSessionProcessingState } from './session-processing.js';

describe('mergeSessionProcessingState', () => {
    it('preserves an active local run when cached history says idle', () => {
        expect(mergeSessionProcessingState(false, true)).toBe(true);
    });

    it('restores processing when history reports the session is busy', () => {
        expect(mergeSessionProcessingState(true, false)).toBe(true);
    });

    it('stays idle when neither source reports activity', () => {
        expect(mergeSessionProcessingState(false, false)).toBe(false);
    });
});
