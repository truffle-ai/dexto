import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientEventBus } from './EventBus.js';
import type { ClientEvent, EventMiddleware } from './types.js';

// Helper to create a test event
function createTestEvent(
    name: 'llm:thinking' | 'llm:chunk' | 'llm:response' = 'llm:thinking',
    sessionId = 'test-session'
): ClientEvent {
    if (name === 'llm:thinking') {
        return { name: 'llm:thinking', sessionId };
    }
    if (name === 'llm:chunk') {
        return { name: 'llm:chunk', sessionId, content: 'test', chunkType: 'text' as const };
    }
    return {
        name: 'llm:response',
        sessionId,
        content: 'test response',
        tokenUsage: { totalTokens: 100 },
    };
}

describe('ClientEventBus', () => {
    let bus: ClientEventBus;

    beforeEach(() => {
        bus = new ClientEventBus();
    });

    describe('dispatch and handlers', () => {
        it('should dispatch events to registered handlers', () => {
            const handler = vi.fn();
            bus.on('llm:thinking', handler);

            const event = createTestEvent('llm:thinking');
            bus.dispatch(event);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(event);
        });

        it('should dispatch events to wildcard handlers', () => {
            const wildcardHandler = vi.fn();
            bus.on('*', wildcardHandler);

            const event = createTestEvent('llm:thinking');
            bus.dispatch(event);

            expect(wildcardHandler).toHaveBeenCalledTimes(1);
            expect(wildcardHandler).toHaveBeenCalledWith(event);
        });

        it('should call both specific and wildcard handlers', () => {
            const specificHandler = vi.fn();
            const wildcardHandler = vi.fn();

            bus.on('llm:thinking', specificHandler);
            bus.on('*', wildcardHandler);

            const event = createTestEvent('llm:thinking');
            bus.dispatch(event);

            expect(specificHandler).toHaveBeenCalledTimes(1);
            expect(wildcardHandler).toHaveBeenCalledTimes(1);
        });

        it('should not call handlers for different event types', () => {
            const handler = vi.fn();
            bus.on('llm:response', handler);

            bus.dispatch(createTestEvent('llm:thinking'));

            expect(handler).not.toHaveBeenCalled();
        });

        it('should support multiple handlers for the same event', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            bus.on('llm:thinking', handler1);
            bus.on('llm:thinking', handler2);

            bus.dispatch(createTestEvent('llm:thinking'));

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
        });
    });

    describe('subscriptions', () => {
        it('should unsubscribe when subscription.unsubscribe() is called', () => {
            const handler = vi.fn();
            const subscription = bus.on('llm:thinking', handler);

            bus.dispatch(createTestEvent('llm:thinking'));
            expect(handler).toHaveBeenCalledTimes(1);

            subscription.unsubscribe();

            bus.dispatch(createTestEvent('llm:thinking'));
            expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
        });

        it('should support once() for single invocation', () => {
            const handler = vi.fn();
            bus.once('llm:thinking', handler);

            bus.dispatch(createTestEvent('llm:thinking'));
            bus.dispatch(createTestEvent('llm:thinking'));

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('should support off() to remove all handlers for an event', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            bus.on('llm:thinking', handler1);
            bus.on('llm:thinking', handler2);

            bus.off('llm:thinking');

            bus.dispatch(createTestEvent('llm:thinking'));

            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).not.toHaveBeenCalled();
        });
    });

    describe('middleware', () => {
        it('should execute middleware in order before handlers', () => {
            const order: string[] = [];

            const middleware1: EventMiddleware = (event, next) => {
                order.push('middleware1-before');
                next(event);
                order.push('middleware1-after');
            };

            const middleware2: EventMiddleware = (event, next) => {
                order.push('middleware2-before');
                next(event);
                order.push('middleware2-after');
            };

            bus.use(middleware1);
            bus.use(middleware2);
            bus.on('llm:thinking', () => order.push('handler'));

            bus.dispatch(createTestEvent('llm:thinking'));

            expect(order).toEqual([
                'middleware1-before',
                'middleware2-before',
                'handler',
                'middleware2-after',
                'middleware1-after',
            ]);
        });

        it('should allow middleware to modify events', () => {
            const handler = vi.fn();

            const modifyingMiddleware: EventMiddleware = (event, next) => {
                if (event.name === 'llm:chunk') {
                    next({
                        ...event,
                        content: 'modified content',
                    } as ClientEvent);
                } else {
                    next(event);
                }
            };

            bus.use(modifyingMiddleware);
            bus.on('llm:chunk', handler);

            bus.dispatch(createTestEvent('llm:chunk'));

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ content: 'modified content' })
            );
        });

        it('should allow middleware to block events', () => {
            const handler = vi.fn();

            const blockingMiddleware: EventMiddleware = (_event, _next) => {
                // Don't call next() - event is blocked
            };

            bus.use(blockingMiddleware);
            bus.on('llm:thinking', handler);

            bus.dispatch(createTestEvent('llm:thinking'));

            expect(handler).not.toHaveBeenCalled();
        });

        it('should prevent duplicate middleware registration', () => {
            const middleware: EventMiddleware = (event, next) => next(event);

            bus.use(middleware);
            bus.use(middleware); // Duplicate

            expect(bus.middlewareCount).toBe(1);
        });

        it('should allow removing middleware', () => {
            const callCount = vi.fn();
            const middleware: EventMiddleware = (event, next) => {
                callCount();
                next(event);
            };

            bus.use(middleware);
            bus.dispatch(createTestEvent('llm:thinking'));
            expect(callCount).toHaveBeenCalledTimes(1);

            bus.removeMiddleware(middleware);
            bus.dispatch(createTestEvent('llm:thinking'));
            expect(callCount).toHaveBeenCalledTimes(1); // Still 1
        });
    });

    describe('event history', () => {
        it('should store events in history', () => {
            bus.dispatch(createTestEvent('llm:thinking'));
            bus.dispatch(createTestEvent('llm:response'));

            const history = bus.getHistory();
            expect(history).toHaveLength(2);
            expect(history[0].name).toBe('llm:thinking');
            expect(history[1].name).toBe('llm:response');
        });

        it('should filter history by predicate', () => {
            bus.dispatch(createTestEvent('llm:thinking'));
            bus.dispatch(createTestEvent('llm:response'));
            bus.dispatch(createTestEvent('llm:thinking'));

            const filtered = bus.getHistory((e) => e.name === 'llm:thinking');
            expect(filtered).toHaveLength(2);
        });

        it('should filter history by session ID', () => {
            bus.dispatch(createTestEvent('llm:thinking', 'session-1'));
            bus.dispatch(createTestEvent('llm:thinking', 'session-2'));
            bus.dispatch(createTestEvent('llm:thinking', 'session-1'));

            const filtered = bus.getHistoryBySession('session-1');
            expect(filtered).toHaveLength(2);
        });

        it('should clear history', () => {
            bus.dispatch(createTestEvent('llm:thinking'));
            bus.dispatch(createTestEvent('llm:response'));

            bus.clearHistory();

            expect(bus.getHistory()).toHaveLength(0);
        });

        it('should limit history to max size', () => {
            // Dispatch more than MAX_HISTORY_SIZE events
            for (let i = 0; i < 1050; i++) {
                bus.dispatch(createTestEvent('llm:thinking', `session-${i}`));
            }

            const history = bus.getHistory();
            expect(history.length).toBeLessThanOrEqual(1000);
        });
    });

    describe('replay', () => {
        it('should replay events through the bus', () => {
            const handler = vi.fn();
            bus.on('llm:thinking', handler);

            const events = [
                createTestEvent('llm:thinking', 'session-1'),
                createTestEvent('llm:thinking', 'session-2'),
            ];

            bus.replay(events);

            expect(handler).toHaveBeenCalledTimes(2);
        });

        it('should set isReplaying flag during replay', () => {
            const replayingStates: boolean[] = [];

            const trackingMiddleware: EventMiddleware = (event, next) => {
                replayingStates.push(bus.isReplaying);
                next(event);
            };

            bus.use(trackingMiddleware);

            // Normal dispatch
            bus.dispatch(createTestEvent('llm:thinking'));
            expect(replayingStates).toEqual([false]);

            // Replay
            bus.replay([createTestEvent('llm:thinking')]);
            expect(replayingStates).toEqual([false, true]);

            // After replay
            bus.dispatch(createTestEvent('llm:thinking'));
            expect(replayingStates).toEqual([false, true, false]);
        });

        it('should reset isReplaying flag even if replay throws', () => {
            const throwingMiddleware: EventMiddleware = () => {
                throw new Error('Test error');
            };

            bus.use(throwingMiddleware);

            expect(() => bus.replay([createTestEvent('llm:thinking')])).toThrow();
            expect(bus.isReplaying).toBe(false);
        });
    });

    describe('error handling', () => {
        it('should catch handler errors and continue to other handlers', () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            const throwingHandler = vi.fn(() => {
                throw new Error('Handler error');
            });
            const normalHandler = vi.fn();

            bus.on('llm:thinking', throwingHandler);
            bus.on('llm:thinking', normalHandler);

            bus.dispatch(createTestEvent('llm:thinking'));

            expect(throwingHandler).toHaveBeenCalled();
            expect(normalHandler).toHaveBeenCalled();
            expect(consoleError).toHaveBeenCalled();

            consoleError.mockRestore();
        });
    });

    describe('counts', () => {
        it('should track handler count', () => {
            expect(bus.handlerCount).toBe(0);

            const sub1 = bus.on('llm:thinking', () => {});
            expect(bus.handlerCount).toBe(1);

            bus.on('llm:response', () => {});
            expect(bus.handlerCount).toBe(2);

            sub1.unsubscribe();
            expect(bus.handlerCount).toBe(1);
        });

        it('should track middleware count', () => {
            expect(bus.middlewareCount).toBe(0);

            const mw: EventMiddleware = (e, n) => n(e);
            bus.use(mw);
            expect(bus.middlewareCount).toBe(1);

            bus.removeMiddleware(mw);
            expect(bus.middlewareCount).toBe(0);
        });
    });
});
