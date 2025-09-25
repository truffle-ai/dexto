import { Hono } from 'hono';
import type { AgentCard } from '@dexto/core';

export function createA2aRouter(agentCard: AgentCard) {
    const app = new Hono();
    app.get('/.well-known/agent.json', (ctx) => {
        return ctx.json(agentCard, 200);
    });
    return app;
}
