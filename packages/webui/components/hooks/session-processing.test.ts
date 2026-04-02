import { describe, expect, it } from 'vitest';
import {
    mergeSessionProcessingState,
    resolveRestoredSessionActivity,
} from './session-processing.js';

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

describe('resolveRestoredSessionActivity', () => {
    it('prefers awaiting approval when approvals are pending', () => {
        expect(
            resolveRestoredSessionActivity({
                isBusy: true,
                hasPendingApprovals: true,
            })
        ).toEqual({
            processing: true,
            status: 'awaiting_approval',
        });
    });

    it('returns thinking when the server still reports a busy run', () => {
        expect(
            resolveRestoredSessionActivity({
                isBusy: true,
                hasPendingApprovals: false,
            })
        ).toEqual({
            processing: true,
            status: 'thinking',
        });
    });

    it('returns idle when the session is no longer active', () => {
        expect(
            resolveRestoredSessionActivity({
                isBusy: false,
                hasPendingApprovals: false,
            })
        ).toEqual({
            processing: false,
            status: 'idle',
        });
    });
});
