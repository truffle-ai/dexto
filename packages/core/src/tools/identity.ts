import { z } from 'zod';

import type { ToolIdentity } from './types.js';

/** Browser-safe schema for the canonical identity of one local or MCP tool. */
export const ToolIdentitySchema: z.ZodType<ToolIdentity> = z.discriminatedUnion('type', [
    z.object({ type: z.literal('local'), toolId: z.string() }).strict(),
    z
        .object({
            type: z.literal('mcp'),
            connectionId: z.string(),
            toolName: z.string(),
        })
        .strict(),
]);

export type { ToolIdentity } from './types.js';
