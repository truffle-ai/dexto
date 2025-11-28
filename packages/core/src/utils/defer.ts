/**
 * TC39 Explicit Resource Management pattern.
 * Similar to Go's `defer`, Python's `with`, C#'s `using`.
 *
 * Benefits:
 * - Can't forget cleanup (automatic on scope exit)
 * - Works with early returns, throws, aborts
 * - Multiple defers execute in LIFO order
 * - Cleaner than try/finally chains
 *
 * @see https://github.com/tc39/proposal-explicit-resource-management
 */

/**
 * Type for cleanup functions - can be sync or async.
 */
export type CleanupFunction = () => void | Promise<void>;

/**
 * Return type for defer() - implements both Disposable and AsyncDisposable.
 */
export interface DeferredCleanup extends Disposable, AsyncDisposable {
    [Symbol.dispose]: () => void;
    [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * Creates a deferred cleanup resource.
 *
 * When used with the `using` keyword, the cleanup function is automatically
 * called when the enclosing scope exits - whether normally, via return,
 * or via thrown exception.
 *
 * @param cleanupFn - The function to call on cleanup. Can be sync or async.
 * @returns A disposable resource for use with `using` keyword
 *
 * @example Synchronous cleanup
 * ```typescript
 * function processData(): void {
 *   using _ = defer(() => console.log('cleanup'));
 *   // ... work ...
 *   // 'cleanup' is logged when scope exits
 * }
 * ```
 *
 * @example Async cleanup with await using
 * ```typescript
 * async function execute(): Promise<void> {
 *   await using _ = defer(async () => {
 *     await closeConnection();
 *   });
 *   // ... work ...
 * }
 * ```
 *
 * @example Multiple defers (LIFO order)
 * ```typescript
 * function example(): void {
 *   using a = defer(() => console.log('first'));
 *   using b = defer(() => console.log('second'));
 *   // Logs: 'second' then 'first' (LIFO)
 * }
 * ```
 */
export function defer(cleanupFn: CleanupFunction): DeferredCleanup {
    return {
        [Symbol.dispose](): void {
            const result = cleanupFn();
            // If cleanup returns a promise in sync context, fire-and-forget with error logging
            if (result instanceof Promise) {
                result.catch((err) => {
                    console.error('Deferred async cleanup failed (used sync dispose):', err);
                });
            }
        },

        [Symbol.asyncDispose](): Promise<void> {
            return Promise.resolve(cleanupFn());
        },
    };
}
