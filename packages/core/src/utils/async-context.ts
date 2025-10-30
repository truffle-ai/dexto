// TODO: Add fallback strategy for non-Node.js environments (browsers, edge workers)
// For now, this will work in Node.js (CLI API server, standalone deployments).
// Future: Consider session metadata fallback when AsyncLocalStorage is unavailable.

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Context data stored in AsyncLocalStorage
 * Used for multi-tenant deployments to propagate tenant/user information
 */
export interface AsyncContext {
    /** Tenant ID for multi-tenant deployments */
    tenantId?: string;

    /** User ID for tracking which user is making the request */
    userId?: string;
}

/**
 * AsyncLocalStorage instance for storing request context
 * This automatically propagates across async boundaries in Node.js
 */
const asyncContext = new AsyncLocalStorage<AsyncContext>();

/**
 * Set the current async context
 * Should be called at the entry point of a request (e.g., Express middleware)
 *
 * @param ctx - Context to set
 *
 * @example
 * ```typescript
 * // In Express middleware
 * app.use((req, res, next) => {
 *   const { tenantId, userId } = extractAuthFromRequest(req);
 *   setContext({ tenantId, userId });
 *   next();
 * });
 * ```
 */
export function setContext(ctx: AsyncContext): void {
    asyncContext.enterWith(ctx);
}

/**
 * Get the current async context
 * Returns undefined if no context is set
 *
 * @returns Current context or undefined
 *
 * @example
 * ```typescript
 * // In plugin or service
 * const ctx = getContext();
 * if (ctx?.tenantId) {
 *   // Use tenant ID for scoped operations
 * }
 * ```
 */
export function getContext(): AsyncContext | undefined {
    return asyncContext.getStore();
}

/**
 * Run a function with a specific context
 * Useful for testing or when you need to override context temporarily
 *
 * @param ctx - Context to run with
 * @param fn - Function to execute
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * await runWithContext({ tenantId: 'test-tenant' }, async () => {
 *   // This code runs with the specified context
 *   await someOperation();
 * });
 * ```
 */
export async function runWithContext<T>(ctx: AsyncContext, fn: () => Promise<T>): Promise<T> {
    return asyncContext.run(ctx, fn);
}

/**
 * Check if AsyncLocalStorage is available in the current environment
 * Returns false in non-Node.js environments (browsers, edge workers)
 *
 * @returns true if AsyncLocalStorage is available
 */
export function isAsyncContextAvailable(): boolean {
    try {
        // Check if async_hooks module exists
        return typeof AsyncLocalStorage !== 'undefined';
    } catch {
        return false;
    }
}
