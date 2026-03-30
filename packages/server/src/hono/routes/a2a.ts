import { Hono } from 'hono';
import type { AgentCard } from '@dexto/core';

export function createA2aRouter(getAgentCard: () => AgentCard) {
    // eslint-disable-next-line dexto-custom/require-openapi-route-contract -- A2A well-known metadata endpoint is protocol metadata, not a normal OpenAPI JSON route.
    const app = new Hono();
    app.get('/.well-known/agent-card.json', (ctx) => {
        const agentCard = getAgentCard();
        return ctx.json(agentCard, 200);
    });
    return app;
}
