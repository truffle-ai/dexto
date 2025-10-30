import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';

const querySchema = z.object({
    sessionId: z.string().optional(),
});

export function createConfigRouter(_getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    return app;
}
