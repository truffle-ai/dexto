import { describe, expect, it } from 'vitest';
import { resolveComposerSubmitIntent } from './composer-submit-intent.js';

describe('resolveComposerSubmitIntent', () => {
    it('sends a normal message when the session is idle', () => {
        expect(
            resolveComposerSubmitIntent({
                processing: false,
                queueFollowUpShortcut: false,
            })
        ).toBe('send');
    });

    it('uses current-turn input while the session is processing', () => {
        expect(
            resolveComposerSubmitIntent({
                processing: true,
                queueFollowUpShortcut: false,
            })
        ).toBe('steer');
    });

    it('queues a follow-up when the shortcut is used during processing', () => {
        expect(
            resolveComposerSubmitIntent({
                processing: true,
                queueFollowUpShortcut: true,
            })
        ).toBe('follow-up');
    });

    it('does not queue follow-up messages when no turn is active', () => {
        expect(
            resolveComposerSubmitIntent({
                processing: false,
                queueFollowUpShortcut: true,
            })
        ).toBe('send');
    });
});
