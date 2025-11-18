import { Hono } from 'hono';
import type { AgentCard } from '@dexto/core';

export function createA2aRouter(getAgentCard: () => AgentCard) {
    const app = new Hono();
    app.get('/.well-known/agent-card.json', (ctx) => {
        const agentCard = getAgentCard();
        return ctx.json(agentCard, 200);
    });
    return app;
}
