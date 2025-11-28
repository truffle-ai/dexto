/**
 * defer() - TC39 Explicit Resource Management pattern implementation.
 *
 * Provides automatic cleanup using the `using` keyword (TypeScript 5.2+).
 * When the scope exits (normally, via throw, or via return), the cleanup
 * function is automatically called.
 *
 * Usage:
 * ```typescript
 * async function myFunction() {
 *   using _ = defer(() => console.log('cleanup'));
 *   // ... do work ...
 *   // cleanup is called automatically when scope exits
 * }
 * ```
 *
 * For async cleanup:
 * ```typescript
 * async function myFunction() {
 *   await using _ = deferAsync(async () => await cleanup());
 *   // ... do work ...
 * }
 * ```
 *
 * @see https://github.com/tc39/proposal-explicit-resource-management
 * @see /complete-context-management-plan.md
 */

/**
 * Disposable interface for synchronous cleanup.
 */
export interface Disposable {
    [Symbol.dispose](): void;
}

/**
 * AsyncDisposable interface for asynchronous cleanup.
 */
export interface AsyncDisposable {
    [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Create a disposable that calls the cleanup function when disposed.
 *
 * Use with `using` keyword:
 * ```typescript
 * using _ = defer(() => cleanup());
 * ```
 *
 * @param cleanup Function to call when scope exits
 * @returns Disposable object
 */
export function defer(cleanup: () => void): Disposable {
    return {
        [Symbol.dispose](): void {
            cleanup();
        },
    };
}

/**
 * Create an async disposable that calls the cleanup function when disposed.
 *
 * Use with `await using` keyword:
 * ```typescript
 * await using _ = deferAsync(async () => await cleanup());
 * ```
 *
 * @param cleanup Async function to call when scope exits
 * @returns AsyncDisposable object
 */
export function deferAsync(cleanup: () => Promise<void>): AsyncDisposable {
    return {
        async [Symbol.asyncDispose](): Promise<void> {
            await cleanup();
        },
    };
}

/**
 * Create a disposable that tracks multiple cleanup functions.
 *
 * Useful when you need to add cleanup handlers dynamically:
 * ```typescript
 * using cleanup = createDisposableStack();
 * cleanup.defer(() => closeConnection());
 * cleanup.defer(() => releaseResource());
 * // All cleanups run in reverse order when scope exits
 * ```
 */
export class DisposableStack implements Disposable {
    private readonly cleanups: Array<() => void> = [];

    /**
     * Add a cleanup function to the stack.
     */
    defer(cleanup: () => void): void {
        this.cleanups.push(cleanup);
    }

    /**
     * Dispose all registered cleanups in reverse order.
     */
    [Symbol.dispose](): void {
        // Run in reverse order (LIFO)
        for (let i = this.cleanups.length - 1; i >= 0; i--) {
            try {
                this.cleanups[i]?.();
            } catch (error) {
                // Log but don't throw - we want to run all cleanups
                console.error('Error in cleanup:', error);
            }
        }
    }
}

/**
 * Create a disposable stack that tracks multiple async cleanup functions.
 */
export class AsyncDisposableStack implements AsyncDisposable {
    private readonly cleanups: Array<() => Promise<void>> = [];

    /**
     * Add an async cleanup function to the stack.
     */
    defer(cleanup: () => Promise<void>): void {
        this.cleanups.push(cleanup);
    }

    /**
     * Dispose all registered cleanups in reverse order.
     */
    async [Symbol.asyncDispose](): Promise<void> {
        // Run in reverse order (LIFO)
        for (let i = this.cleanups.length - 1; i >= 0; i--) {
            try {
                await this.cleanups[i]?.();
            } catch (error) {
                // Log but don't throw - we want to run all cleanups
                console.error('Error in async cleanup:', error);
            }
        }
    }
}

/**
 * Create a new disposable stack for synchronous cleanups.
 */
export function createDisposableStack(): DisposableStack {
    return new DisposableStack();
}

/**
 * Create a new disposable stack for async cleanups.
 */
export function createAsyncDisposableStack(): AsyncDisposableStack {
    return new AsyncDisposableStack();
}
