import type { ZodTypeAny } from 'zod';
import type { Tool } from './types.js';

/**
 * Typed identity helper for defining tools.
 *
 * Why: TypeScript only infers `execute(...)` argument types from `inputSchema` reliably
 * when the object literal is contextually typed. `defineTool(...)` provides that
 * context and keeps tool definitions consistent across packages.
 */
export function defineTool<const TSchema extends ZodTypeAny>(tool: Tool<TSchema>): Tool<TSchema> {
    return tool;
}
