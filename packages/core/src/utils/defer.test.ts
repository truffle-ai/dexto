import { describe, it, expect, vi } from 'vitest';
import { defer } from './defer.js';

describe('defer', () => {
    describe('sync dispose (using keyword)', () => {
        it('should call cleanup on normal scope exit', () => {
            const cleanup = vi.fn();

            function testScope(): void {
                using _ = defer(cleanup);
                // Normal exit
            }

            testScope();
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should call cleanup on early return', () => {
            const cleanup = vi.fn();

            function testScope(): string {
                using _ = defer(cleanup);
                return 'early';
            }

            const result = testScope();
            expect(result).toBe('early');
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should call cleanup on throw', () => {
            const cleanup = vi.fn();

            function testScope(): void {
                using _ = defer(cleanup);
                throw new Error('test error');
            }

            expect(() => testScope()).toThrow('test error');
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should execute multiple defers in LIFO order', () => {
            const order: number[] = [];

            function testScope(): void {
                using _a = defer(() => {
                    order.push(1);
                });
                using _b = defer(() => {
                    order.push(2);
                });
                using _c = defer(() => {
                    order.push(3);
                });
            }

            testScope();
            expect(order).toEqual([3, 2, 1]);
        });

        it('should handle async cleanup function in sync context', async () => {
            const cleanup = vi.fn().mockResolvedValue(undefined);
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            function testScope(): void {
                using _ = defer(cleanup);
            }

            testScope();
            expect(cleanup).toHaveBeenCalledTimes(1);

            // Give time for any promise rejections to surface
            await new Promise((resolve) => setTimeout(resolve, 10));
            consoleError.mockRestore();
        });
    });

    describe('async dispose (await using keyword)', () => {
        it('should call async cleanup on normal scope exit', async () => {
            const cleanup = vi.fn().mockResolvedValue(undefined);

            async function testScope(): Promise<void> {
                await using _ = defer(cleanup);
                // Normal exit
            }

            await testScope();
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should call async cleanup on throw', async () => {
            const cleanup = vi.fn().mockResolvedValue(undefined);

            async function testScope(): Promise<void> {
                await using _ = defer(cleanup);
                throw new Error('async error');
            }

            await expect(testScope()).rejects.toThrow('async error');
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should await async cleanup function', async () => {
            let cleanupCompleted = false;
            const cleanup = vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                cleanupCompleted = true;
            });

            async function testScope(): Promise<void> {
                await using _ = defer(cleanup);
            }

            await testScope();
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(cleanupCompleted).toBe(true);
        });

        it('should execute multiple async defers in LIFO order', async () => {
            const order: number[] = [];

            async function testScope(): Promise<void> {
                await using _a = defer(async () => {
                    order.push(1);
                });
                await using _b = defer(async () => {
                    order.push(2);
                });
                await using _c = defer(async () => {
                    order.push(3);
                });
            }

            await testScope();
            expect(order).toEqual([3, 2, 1]);
        });
    });

    describe('Symbol.dispose interface', () => {
        it('should implement Symbol.dispose', () => {
            const cleanup = vi.fn();
            const deferred = defer(cleanup);

            expect(typeof deferred[Symbol.dispose]).toBe('function');

            deferred[Symbol.dispose]();
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should implement Symbol.asyncDispose', async () => {
            const cleanup = vi.fn().mockResolvedValue(undefined);
            const deferred = defer(cleanup);

            expect(typeof deferred[Symbol.asyncDispose]).toBe('function');

            await deferred[Symbol.asyncDispose]();
            expect(cleanup).toHaveBeenCalledTimes(1);
        });
    });

    describe('error handling', () => {
        it('should propagate errors from sync cleanup in sync context', () => {
            const cleanup = vi.fn(() => {
                throw new Error('cleanup error');
            });

            function testScope(): void {
                using _ = defer(cleanup);
            }

            expect(() => testScope()).toThrow('cleanup error');
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should propagate errors from async cleanup in async context', async () => {
            const cleanup = vi.fn().mockRejectedValue(new Error('async cleanup error'));

            async function testScope(): Promise<void> {
                await using _ = defer(cleanup);
            }

            await expect(testScope()).rejects.toThrow('async cleanup error');
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('should log error when async cleanup fails in sync context', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const cleanup = vi.fn().mockRejectedValue(new Error('async fail'));

            function testScope(): void {
                using _ = defer(cleanup);
            }

            testScope();

            // Wait for the promise rejection to be caught
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(consoleError).toHaveBeenCalledWith(
                'Deferred async cleanup failed (used sync dispose):',
                expect.any(Error)
            );
            consoleError.mockRestore();
        });
    });
});
