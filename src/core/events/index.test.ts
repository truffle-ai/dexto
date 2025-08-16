import { describe, it, expect, vi } from 'vitest';
import { AgentEventBus } from './index.js';

describe('EventBus AbortController Support', () => {
    it('should remove event listener when signal is aborted', () => {
        const eventBus = new AgentEventBus();
        const abortController = new AbortController();
        const listener = vi.fn();

        // Add listener with abort signal
        eventBus.on('dexto:conversationReset', listener, { signal: abortController.signal });

        // Emit event - should be received
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener).toHaveBeenCalledTimes(1);

        // Abort the signal
        abortController.abort();

        // Emit event again - should not be received
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should not add listener if signal is already aborted', () => {
        const eventBus = new AgentEventBus();
        const abortController = new AbortController();
        const listener = vi.fn();

        // Abort signal first
        abortController.abort();

        // Try to add listener with aborted signal
        eventBus.on('dexto:conversationReset', listener, { signal: abortController.signal });

        // Emit event - should not be received
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener).not.toHaveBeenCalled();
    });

    it('should work with once() and abort signal', () => {
        const eventBus = new AgentEventBus();
        const abortController = new AbortController();
        const listener = vi.fn();

        // Add once listener with abort signal
        eventBus.once('dexto:conversationReset', listener, { signal: abortController.signal });

        // Abort the signal before emitting
        abortController.abort();

        // Emit event - should not be received
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener).not.toHaveBeenCalled();
    });

    it('should work without signal (backward compatibility)', () => {
        const eventBus = new AgentEventBus();
        const listener = vi.fn();

        // Add listener without signal (old way)
        eventBus.on('dexto:conversationReset', listener);

        // Emit event - should be received
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener).toHaveBeenCalledTimes(1);

        // Remove manually
        eventBus.off('dexto:conversationReset', listener);

        // Emit event again - should not be received
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple listeners with different signals', () => {
        const eventBus = new AgentEventBus();
        const controller1 = new AbortController();
        const controller2 = new AbortController();
        const listener1 = vi.fn();
        const listener2 = vi.fn();
        const listener3 = vi.fn();

        // Add listeners with different signals
        eventBus.on('dexto:conversationReset', listener1, { signal: controller1.signal });
        eventBus.on('dexto:conversationReset', listener2, { signal: controller2.signal });
        eventBus.on('dexto:conversationReset', listener3); // No signal

        // Emit event - all should receive
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);
        expect(listener3).toHaveBeenCalledTimes(1);

        // Abort first signal
        controller1.abort();

        // Emit event - only listener2 and listener3 should receive
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener1).toHaveBeenCalledTimes(1); // Still 1
        expect(listener2).toHaveBeenCalledTimes(2);
        expect(listener3).toHaveBeenCalledTimes(2);

        // Abort second signal
        controller2.abort();

        // Emit event - only listener3 should receive
        eventBus.emit('dexto:conversationReset', { sessionId: 'test' });
        expect(listener1).toHaveBeenCalledTimes(1); // Still 1
        expect(listener2).toHaveBeenCalledTimes(2); // Still 2
        expect(listener3).toHaveBeenCalledTimes(3);
    });
});
