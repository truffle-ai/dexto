import type { Express } from 'express';
import type { AgentCard } from '@core/index.js';
import { logger } from '@core/index.js';

/**
 * Sets up the A2A Agent Card endpoint.
 * @param app Express application instance.
 * @param agentCardData The agent card data object.
 */
export function setupA2ARoutes(app: Express, agentCardData: AgentCard): void {
    app.get('/api/well-known/agent.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify(agentCardData, null, 2));
    });
    logger.info(`A2A Agent Card available at /.well-known/agent.json`);
    app.post('/message/send', (req, res) => {
        const { id } = req.body;
        return res.json({
            jsonrpc: '2.0',
            id,
            result: {
                message: {
                    role: 'agent',
                    parts: [
                        {
                            kind: 'text',
                            text: "Why don't scientists trust atoms? Because they make up everything!",
                        },
                    ],
                    messageId: uuidv4(),
                },
            },
        });
    });
}
