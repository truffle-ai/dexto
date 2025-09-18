import { Hono } from 'hono';
import type { AgentCard } from '@dexto/core';

export function createA2aRouter(agentCard: AgentCard) {
    const app = new Hono();
    app.get('/.well-known/agent.json', (ctx) => {
        ctx.header('Content-Type', 'application/json');
        return ctx.body(JSON.stringify(agentCard, null, 2));
    });
    return app;
}
