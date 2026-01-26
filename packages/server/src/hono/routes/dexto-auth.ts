import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { GetAgentFn } from '../index.js';
import {
    isDextoAuthEnabled,
    isDextoAuthenticated,
    canUseDextoProvider,
} from '@dexto/agent-management';

/**
 * Dexto authentication status routes.
 * Provides endpoints to check dexto auth status for Web UI.
 */
export function createDextoAuthRouter(_getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const statusRoute = createRoute({
        method: 'get',
        path: '/status',
        summary: 'Dexto Auth Status',
        description:
            'Returns dexto authentication status. Used by Web UI to check if user can use dexto features.',
        tags: ['auth'],
        responses: {
            200: {
                description: 'Dexto auth status',
                content: {
                    'application/json': {
                        schema: z.object({
                            enabled: z.boolean().describe('Whether dexto auth feature is enabled'),
                            authenticated: z
                                .boolean()
                                .describe('Whether user is authenticated with dexto'),
                            canUse: z
                                .boolean()
                                .describe(
                                    'Whether user can use dexto (authenticated AND has API key)'
                                ),
                        }),
                    },
                },
            },
        },
    });

    return app.openapi(statusRoute, async (c) => {
        const enabled = isDextoAuthEnabled();

        if (!enabled) {
            return c.json({
                enabled: false,
                authenticated: false,
                canUse: false,
            });
        }

        const authenticated = await isDextoAuthenticated();
        const canUse = await canUseDextoProvider();

        return c.json({
            enabled,
            authenticated,
            canUse,
        });
    });
}
