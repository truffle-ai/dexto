import type { Express } from 'express';
import type { AgentCard } from '@dexto/core';
import { logger } from '@dexto/core';

/**
 * Sets up the A2A Agent Card endpoint.
 * @param app Express application instance.
 * @param getAgentCard Getter function that returns the current agent card.
 */
export function setupA2ARoutes(app: Express, getAgentCard: () => AgentCard): void {
    app.get('/.well-known/agent.json', (_req, res) => {
        const agentCardData = getAgentCard();
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify(agentCardData, null, 2));
    });
    logger.info(`A2A Agent Card available at /.well-known/agent.json`);
}
