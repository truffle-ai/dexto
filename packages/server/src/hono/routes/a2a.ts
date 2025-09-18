import { Hono } from 'hono';
import type { AgentCard } from '@dexto/core';
import { sendJson } from '../utils/response.js';

export function createA2aRouter(agentCard: AgentCard) {
    const app = new Hono();
    app.get('/.well-known/agent.json', (ctx) => {
        return sendJson(ctx, agentCard, 200, { pretty: true });
    });
    return app;
}
