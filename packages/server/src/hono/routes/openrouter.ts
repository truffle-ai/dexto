/**
 * OpenRouter Validation Routes
 *
 * Standalone routes for validating OpenRouter model IDs against the registry.
 * Decoupled from agent runtime - can be used independently.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
    logger,
    lookupOpenRouterModel,
    refreshOpenRouterModelCache,
    getOpenRouterModelInfo,
} from '@dexto/core';

const ValidateModelParamsSchema = z
    .object({
        modelId: z
            .string()
            .min(1)
            .describe('OpenRouter model ID to validate (e.g., anthropic/claude-3.5-sonnet)'),
    })
    .describe('Path parameters for model validation');

const ValidateModelResponseSchema = z
    .object({
        valid: z.boolean().describe('Whether the model ID is valid'),
        modelId: z.string().describe('The model ID that was validated'),
        status: z
            .enum(['valid', 'invalid', 'unknown'])
            .describe('Validation status: valid, invalid, or unknown (cache empty)'),
        error: z.string().optional().describe('Error message if invalid'),
        info: z
            .object({
                contextLength: z.number().describe('Model context length in tokens'),
            })
            .optional()
            .describe('Model information if valid'),
    })
    .describe('Model validation response');

/**
 * Create OpenRouter validation router.
 * No agent dependency - purely utility routes.
 */
export function createOpenRouterRouter() {
    const app = new OpenAPIHono();

    const validateRoute = createRoute({
        method: 'get',
        path: '/openrouter/validate/{modelId}',
        summary: 'Validate OpenRouter Model',
        description:
            'Validates an OpenRouter model ID against the cached model registry. Refreshes cache if stale.',
        tags: ['openrouter'],
        request: {
            params: ValidateModelParamsSchema,
        },
        responses: {
            200: {
                description: 'Validation result',
                content: {
                    'application/json': {
                        schema: ValidateModelResponseSchema,
                    },
                },
            },
        },
    });

    const refreshRoute = createRoute({
        method: 'post',
        path: '/openrouter/refresh-cache',
        summary: 'Refresh OpenRouter Model Cache',
        description: 'Forces a refresh of the OpenRouter model registry cache from the API.',
        tags: ['openrouter'],
        responses: {
            200: {
                description: 'Cache refreshed successfully',
                content: {
                    'application/json': {
                        schema: z.object({
                            ok: z.literal(true).describe('Success indicator'),
                            message: z.string().describe('Status message'),
                        }),
                    },
                },
            },
            500: {
                description: 'Cache refresh failed',
                content: {
                    'application/json': {
                        schema: z.object({
                            ok: z.literal(false).describe('Failure indicator'),
                            message: z.string().describe('Error message'),
                        }),
                    },
                },
            },
        },
    });

    return app
        .openapi(validateRoute, async (ctx) => {
            const { modelId: encodedModelId } = ctx.req.valid('param');
            // Decode URL-encoded model ID to handle slashes (e.g., anthropic/claude-3.5-sonnet)
            const modelId = decodeURIComponent(encodedModelId);

            // First lookup against current cache
            let status = lookupOpenRouterModel(modelId);

            // If unknown (cache empty/stale), try refreshing
            if (status === 'unknown') {
                try {
                    await refreshOpenRouterModelCache();
                    status = lookupOpenRouterModel(modelId);
                } catch (error) {
                    // Network failed - return unknown status
                    logger.warn(
                        `OpenRouter cache refresh failed during validation: ${error instanceof Error ? error.message : String(error)}`
                    );
                    return ctx.json({
                        valid: false,
                        modelId,
                        status: 'unknown' as const,
                        error: 'Could not validate model - cache refresh failed',
                    });
                }
            }

            if (status === 'invalid') {
                return ctx.json({
                    valid: false,
                    modelId,
                    status: 'invalid' as const,
                    error: `Model '${modelId}' not found in OpenRouter. Check the model ID at https://openrouter.ai/models`,
                });
            }

            // Valid - include model info
            const info = getOpenRouterModelInfo(modelId);
            return ctx.json({
                valid: true,
                modelId,
                status: 'valid' as const,
                ...(info && { info: { contextLength: info.contextLength } }),
            });
        })
        .openapi(refreshRoute, async (ctx) => {
            try {
                await refreshOpenRouterModelCache();
                return ctx.json(
                    {
                        ok: true as const,
                        message: 'OpenRouter model cache refreshed successfully',
                    },
                    200
                );
            } catch (error) {
                logger.error(
                    `Failed to refresh OpenRouter cache: ${error instanceof Error ? error.message : String(error)}`
                );
                return ctx.json(
                    {
                        ok: false as const,
                        message: 'Failed to refresh OpenRouter model cache',
                    },
                    500
                );
            }
        });
}
