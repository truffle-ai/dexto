import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EventForwarder } from './event-forwarder.js';
import { AgentEventBus, SessionEventBus } from '../events/index.js';

describe('EventForwarder', () => {
    let sourceEventBus: AgentEventBus;
    let targetEventBus: SessionEventBus;
    let mockLogger: any;

    beforeEach(() => {
        sourceEventBus = new AgentEventBus();
        targetEventBus = new SessionEventBus();
        mockLogger = {
            debug: vi.fn(),
            silly: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
    });

    describe('forward()', () => {
        test('should forward events from source to target', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);
            const listener = vi.fn();

            // Set up target listener
            targetEventBus.on('llmservice:thinking', listener);

            // Set up forwarding
            forwarder.forward('llmservice:thinking');

            // Emit on source
            sourceEventBus.emit('llmservice:thinking', { sessionId: 'test-session' });

            // Verify forwarded
            expect(listener).toHaveBeenCalledOnce();
            expect(listener).toHaveBeenCalledWith({ sessionId: 'test-session' });
        });

        test('should augment payload when augmentPayload provided', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);
            const listener = vi.fn();

            targetEventBus.on('llmservice:chunk', listener);

            forwarder.forward('llmservice:chunk', {
                augmentPayload: (payload) => ({
                    ...payload,
                    fromSubAgent: true,
                    depth: 1,
                }),
            });

            sourceEventBus.emit('llmservice:chunk', {
                type: 'text',
                content: 'hello',
                sessionId: 'test-session',
            });

            expect(listener).toHaveBeenCalledWith({
                type: 'text',
                content: 'hello',
                sessionId: 'test-session',
                fromSubAgent: true,
                depth: 1,
            });
        });

        test('should filter events when filter returns false', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);
            const listener = vi.fn();

            targetEventBus.on('llmservice:toolCall', listener);

            forwarder.forward('llmservice:toolCall', {
                filter: (payload) => payload?.sessionId === 'allowed-session',
            });

            // This should be filtered out
            sourceEventBus.emit('llmservice:toolCall', {
                toolName: 'test',
                args: {},
                sessionId: 'blocked-session',
            });

            expect(listener).not.toHaveBeenCalled();

            // This should pass through
            sourceEventBus.emit('llmservice:toolCall', {
                toolName: 'test',
                args: {},
                sessionId: 'allowed-session',
            });

            expect(listener).toHaveBeenCalledOnce();
            expect(listener).toHaveBeenCalledWith({
                toolName: 'test',
                args: {},
                sessionId: 'allowed-session',
            });
        });

        test('should handle multiple forwarders for different events', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);
            const thinkingListener = vi.fn();
            const chunkListener = vi.fn();

            targetEventBus.on('llmservice:thinking', thinkingListener);
            targetEventBus.on('llmservice:chunk', chunkListener);

            forwarder.forward('llmservice:thinking');
            forwarder.forward('llmservice:chunk');

            sourceEventBus.emit('llmservice:thinking', { sessionId: 'test' });
            sourceEventBus.emit('llmservice:chunk', {
                type: 'text',
                content: 'test',
                sessionId: 'test',
            });

            expect(thinkingListener).toHaveBeenCalledOnce();
            expect(chunkListener).toHaveBeenCalledOnce();
        });

        test('should not register duplicate forwarders for same event', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);
            const listener = vi.fn();

            targetEventBus.on('llmservice:thinking', listener);

            forwarder.forward('llmservice:thinking');
            forwarder.forward('llmservice:thinking'); // Duplicate

            sourceEventBus.emit('llmservice:thinking', { sessionId: 'test' });

            // Should only be called once (not twice)
            expect(listener).toHaveBeenCalledOnce();
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('already exists'));
        });

        test('should handle errors in forwarding gracefully', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);

            // Set up augmentPayload that throws
            forwarder.forward('llmservice:thinking', {
                augmentPayload: () => {
                    throw new Error('Augment error');
                },
            });

            // Should not throw
            expect(() => {
                sourceEventBus.emit('llmservice:thinking', { sessionId: 'test' });
            }).not.toThrow();

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error forwarding event')
            );
        });
    });

    describe('dispose()', () => {
        test('should remove all event listeners', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);
            const listener = vi.fn();

            targetEventBus.on('llmservice:thinking', listener);
            forwarder.forward('llmservice:thinking');

            // Emit before dispose
            sourceEventBus.emit('llmservice:thinking', { sessionId: 'test' });
            expect(listener).toHaveBeenCalledOnce();

            // Dispose
            forwarder.dispose();

            // Emit after dispose
            listener.mockClear();
            sourceEventBus.emit('llmservice:thinking', { sessionId: 'test' });
            expect(listener).not.toHaveBeenCalled();
        });

        test('should clear internal forwarders map', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);

            forwarder.forward('llmservice:thinking');
            forwarder.forward('llmservice:chunk');

            expect(forwarder.count).toBe(2);

            forwarder.dispose();

            expect(forwarder.count).toBe(0);
        });

        test('should log disposal', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);

            forwarder.forward('llmservice:thinking');
            forwarder.forward('llmservice:chunk');

            forwarder.dispose();

            expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Disposed 2'));
        });
    });

    describe('count', () => {
        test('should return number of registered forwarders', () => {
            const forwarder = new EventForwarder(sourceEventBus, targetEventBus, mockLogger);

            expect(forwarder.count).toBe(0);

            forwarder.forward('llmservice:thinking');
            expect(forwarder.count).toBe(1);

            forwarder.forward('llmservice:chunk');
            expect(forwarder.count).toBe(2);

            forwarder.dispose();
            expect(forwarder.count).toBe(0);
        });
    });
});
