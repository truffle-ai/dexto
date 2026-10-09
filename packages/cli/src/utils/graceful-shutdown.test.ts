import type { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdown } from './graceful-shutdown.js';

vi.mock('@dexto/core', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

const processEvents: EventEmitter = process;
const events = ['SIGTERM', 'SIGUSR2', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;

describe('owned graceful shutdown listeners', () => {
    it('disposes only its listeners and can be disposed repeatedly', () => {
        const previous = events.map((event) => processEvents.listeners(event));
        const dispose = registerGracefulShutdown(() => ({ stop: vi.fn() }));
        try {
            events.forEach((event, index) => {
                expect(processEvents.listenerCount(event)).toBe(previous[index]!.length + 1);
            });
            expect(dispose).toBeTypeOf('function');
            dispose();
            dispose();
            events.forEach((event, index) => {
                expect(processEvents.listeners(event)).toEqual(previous[index]);
            });
        } finally {
            events.forEach((event, index) => {
                for (const listener of processEvents.listeners(event)) {
                    if (!previous[index]!.includes(listener))
                        processEvents.removeListener(
                            event,
                            listener as (...args: unknown[]) => void
                        );
                }
            });
        }
    });
    it('preserves Ink first Ctrl+C handling and clears its owned timer on disposal', () => {
        vi.useFakeTimers();
        const stop = vi.fn(async () => undefined);
        const previous = processEvents.listeners('SIGINT');
        const dispose = registerGracefulShutdown(() => ({ stop }), { inkMode: true });
        try {
            const listener = processEvents
                .listeners('SIGINT')
                .find((candidate) => !previous.includes(candidate));
            if (!listener) throw new Error('Expected owned Ink listener');
            Reflect.apply(listener, process, []);
            expect(stop).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(1);
            dispose();
            expect(vi.getTimerCount()).toBe(0);
            expect(processEvents.listeners('SIGINT')).toEqual(previous);
        } finally {
            dispose();
            vi.useRealTimers();
        }
    });
});
