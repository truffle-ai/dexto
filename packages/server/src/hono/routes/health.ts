import { Hono } from 'hono';
import type { DextoAgent } from '@dexto/core';

/**
 * NOTE: If we introduce a transport-agnostic handler layer later, the logic in this module can move
 * into that layer. For now we keep the implementation inline for simplicity.
 */
export function createHealthRouter(_agent: DextoAgent) {
    const app = new Hono();

    app.get('/', (ctx) => ctx.json({ status: 'ok' as const }));

    return app;
}
