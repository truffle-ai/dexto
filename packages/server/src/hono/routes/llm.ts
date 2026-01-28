import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
import {
    LLM_REGISTRY,
    LLM_PROVIDERS,
    SUPPORTED_FILE_TYPES,
    supportsBaseURL,
    getAllModelsForProvider,
    getCuratedModelsForProvider,
    getSupportedFileTypesForModel,
    type ProviderInfo,
    type LLMProvider,
    type SupportedFileType,
    LLMUpdatesSchema,
} from '@dexto/core';
import {
    getProviderKeyStatus,
    loadCustomModels,
    saveCustomModel,
    deleteCustomModel,
    CustomModelSchema,
    isDextoAuthEnabled,
} from '@dexto/agent-management';
import type { Context } from 'hono';
import {
    ProviderCatalogSchema,
    ModelFlatSchema,
    LLMConfigResponseSchema,
} from '../schemas/responses.js';

type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

const CurrentQuerySchema = z
    .object({
        sessionId: z
            .string()
            .optional()
            .describe('Session identifier to retrieve session-specific LLM configuration'),
    })
    .describe('Query parameters for getting current LLM configuration');

const CatalogQuerySchema = z
    .object({
        scope: z
            .enum(['curated', 'all'])
            .default('all')
            .describe(
                "Catalog scope: 'curated' returns a small, UI-friendly set of models; 'all' returns the full registry (can be large)"
            ),
        provider: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .transform((value): string[] | undefined =>
                Array.isArray(value) ? value : value ? value.split(',') : undefined
            )
            .describe('Comma-separated list of LLM providers to filter by'),
        includeModels: z
            .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
            .optional()
            .transform((raw): boolean | undefined =>
                raw === 'true' || raw === '1'
                    ? true
                    : raw === 'false' || raw === '0'
                      ? false
                      : undefined
            )
            .describe('Include models list in the response (true or false)'),
        hasKey: z
            .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
            .optional()
            .transform((raw): boolean | undefined =>
                raw === 'true' || raw === '1'
                    ? true
                    : raw === 'false' || raw === '0'
                      ? false
                      : undefined
            )
            .describe('Filter by API key presence (true or false)'),
        fileType: z
            .enum(SUPPORTED_FILE_TYPES)
            .optional()
            .describe('Filter by supported file type (audio, pdf, or image)'),
        defaultOnly: z
            .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
            .optional()
            .transform((raw): boolean | undefined =>
                raw === 'true' || raw === '1'
                    ? true
                    : raw === 'false' || raw === '0'
                      ? false
                      : undefined
            )
            .describe('Include only default models (true or false)'),
        mode: z
            .enum(['grouped', 'flat'])
            .default('grouped')
            .describe('Response format mode (grouped by provider or flat list)'),
    })
    .describe('Query parameters for filtering and formatting the LLM catalog');

// Combine LLM updates schema with sessionId for API requests
// LLMUpdatesSchema is no longer strict, so it accepts extra fields like sessionId
const SwitchLLMBodySchema = LLMUpdatesSchema.and(
    z.object({
        sessionId: z
            .string()
            .optional()
            .describe('Session identifier for session-specific LLM configuration'),
    })
).describe('LLM switch request body with optional session ID and LLM fields');

export function createLlmRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const currentRoute = createRoute({
        method: 'get',
        path: '/llm/current',
        summary: 'Get Current LLM Config',
        description: 'Retrieves the current LLM configuration for the agent or a specific session',
        tags: ['llm'],
        request: { query: CurrentQuerySchema },
        responses: {
            200: {
                description: 'Current LLM config',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                config: LLMConfigResponseSchema.partial({
                                    maxIterations: true,
                                }).extend({
                                    displayName: z
                                        .string()
                                        .optional()
                                        .describe('Human-readable model display name'),
                                }),
                                routing: z
                                    .object({
                                        viaDexto: z
                                            .boolean()
                                            .describe(
                                                'Whether requests route through Dexto gateway'
                                            ),
                                    })
                                    .describe(
                                        'Routing information for the current LLM configuration'
                                    ),
                            })
                            .describe('Response containing current LLM configuration'),
                    },
                },
            },
        },
    });
    const catalogRoute = createRoute({
        method: 'get',
        path: '/llm/catalog',
        summary: 'LLM Catalog',
        description: 'Providers, models, capabilities, and API key status',
        tags: ['llm'],
        request: { query: CatalogQuerySchema },
        responses: {
            200: {
                description: 'LLM catalog',
                content: {
                    'application/json': {
                        schema: z
                            .union([
                                z
                                    .object({
                                        providers: z
                                            .record(z.enum(LLM_PROVIDERS), ProviderCatalogSchema)
                                            .describe(
                                                'Providers grouped by ID with their models and capabilities'
                                            ),
                                    })
                                    .strict()
                                    .describe('Grouped catalog response (mode=grouped)'),
                                z
                                    .object({
                                        models: z
                                            .array(ModelFlatSchema)
                                            .describe(
                                                'Flat list of all models with provider information'
                                            ),
                                    })
                                    .strict()
                                    .describe('Flat catalog response (mode=flat)'),
                            ])
                            .describe(
                                'LLM catalog in grouped or flat format based on mode query parameter'
                            ),
                    },
                },
            },
        },
    });

    const switchRoute = createRoute({
        method: 'post',
        path: '/llm/switch',
        summary: 'Switch LLM',
        description: 'Switches the LLM configuration for the agent or a specific session',
        tags: ['llm'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: SwitchLLMBodySchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'LLM switch result',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                config: LLMConfigResponseSchema.describe(
                                    'New LLM configuration with all defaults applied (apiKey omitted)'
                                ),
                                sessionId: z
                                    .string()
                                    .optional()
                                    .describe('Session ID if session-specific switch'),
                            })
                            .describe('LLM switch result'),
                    },
                },
            },
        },
    });

    // Custom models routes
    const listCustomModelsRoute = createRoute({
        method: 'get',
        path: '/llm/custom-models',
        summary: 'List Custom Models',
        description: 'Returns all saved custom openai-compatible model configurations',
        tags: ['llm'],
        responses: {
            200: {
                description: 'List of custom models',
                content: {
                    'application/json': {
                        schema: z.object({
                            models: z.array(CustomModelSchema).describe('List of custom models'),
                        }),
                    },
                },
            },
        },
    });

    const createCustomModelRoute = createRoute({
        method: 'post',
        path: '/llm/custom-models',
        summary: 'Create Custom Model',
        description: 'Saves a new custom openai-compatible model configuration',
        tags: ['llm'],
        request: {
            body: { content: { 'application/json': { schema: CustomModelSchema } } },
        },
        responses: {
            200: {
                description: 'Custom model saved',
                content: {
                    'application/json': {
                        schema: z.object({
                            ok: z.literal(true).describe('Success indicator'),
                            model: CustomModelSchema,
                        }),
                    },
                },
            },
        },
    });

    const deleteCustomModelRoute = createRoute({
        method: 'delete',
        path: '/llm/custom-models/{name}',
        summary: 'Delete Custom Model',
        description: 'Deletes a custom model by name',
        tags: ['llm'],
        request: {
            params: z.object({
                name: z.string().min(1).describe('Model name to delete'),
            }),
        },
        responses: {
            200: {
                description: 'Custom model deleted',
                content: {
                    'application/json': {
                        schema: z.object({
                            ok: z.literal(true).describe('Success indicator'),
                            deleted: z.string().describe('Name of the deleted model'),
                        }),
                    },
                },
            },
            404: {
                description: 'Custom model not found',
                content: {
                    'application/json': {
                        schema: z.object({
                            ok: z.literal(false).describe('Failure indicator'),
                            error: z.string().describe('Error message'),
                        }),
                    },
                },
            },
        },
    });

    // Model capabilities endpoint - resolves gateway providers to underlying model capabilities
    const capabilitiesRoute = createRoute({
        method: 'get',
        path: '/llm/capabilities',
        summary: 'Get Model Capabilities',
        description:
            'Returns the capabilities (supported file types) for a specific provider/model combination. ' +
            'Handles gateway providers (dexto, openrouter) by resolving to the underlying model capabilities.',
        tags: ['llm'],
        request: {
            query: z.object({
                provider: z.enum(LLM_PROVIDERS).describe('LLM provider name'),
                model: z
                    .string()
                    .min(1)
                    .describe('Model name (supports both native and OpenRouter format)'),
            }),
        },
        responses: {
            200: {
                description: 'Model capabilities',
                content: {
                    'application/json': {
                        schema: z.object({
                            provider: z.enum(LLM_PROVIDERS).describe('Provider name'),
                            model: z.string().describe('Model name as provided'),
                            supportedFileTypes: z
                                .array(z.enum(SUPPORTED_FILE_TYPES))
                                .describe('File types supported by this model'),
                        }),
                    },
                },
            },
        },
    });

    return app
        .openapi(currentRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('query');

            const currentConfig = sessionId
                ? agent.getEffectiveConfig(sessionId).llm
                : agent.getCurrentLLMConfig();

            let displayName: string | undefined;
            try {
                // First check registry for built-in models
                const model = LLM_REGISTRY[currentConfig.provider]?.models.find(
                    (m) => m.name.toLowerCase() === String(currentConfig.model).toLowerCase()
                );
                displayName = model?.displayName || undefined;

                // If not found in registry, check custom models
                if (!displayName) {
                    const customModels = await loadCustomModels();
                    const customModel = customModels.find(
                        (cm) => cm.name.toLowerCase() === String(currentConfig.model).toLowerCase()
                    );
                    displayName = customModel?.displayName || undefined;
                }
            } catch {
                // ignore lookup errors
            }

            // Omit apiKey from response for security
            const { apiKey, ...configWithoutKey } = currentConfig;

            // With explicit providers, viaDexto is simply whether the provider is 'dexto'
            // Only report viaDexto when the feature is enabled
            const viaDexto = isDextoAuthEnabled() && currentConfig.provider === 'dexto';

            return ctx.json({
                config: {
                    ...configWithoutKey,
                    hasApiKey: !!apiKey,
                    ...(displayName && { displayName }),
                },
                routing: {
                    viaDexto,
                },
            });
        })
        .openapi(catalogRoute, (ctx) => {
            type ProviderCatalog = Pick<ProviderInfo, 'models' | 'supportedFileTypes'> & {
                name: string;
                hasApiKey: boolean;
                primaryEnvVar: string;
                supportsBaseURL: boolean;
            };

            type ModelFlat = ProviderCatalog['models'][number] & { provider: LLMProvider };

            const queryParams = ctx.req.valid('query');
            const includeModels = queryParams.includeModels ?? true;
            const scope = queryParams.scope ?? 'all';

            const providers: Record<string, ProviderCatalog> = {};

            for (const provider of LLM_PROVIDERS) {
                // Skip dexto provider when feature is not enabled
                if (provider === 'dexto' && !isDextoAuthEnabled()) {
                    continue;
                }

                const info = LLM_REGISTRY[provider];
                const displayName = provider.charAt(0).toUpperCase() + provider.slice(1);
                const keyStatus = getProviderKeyStatus(provider);

                const models = (() => {
                    if (!includeModels) return [];
                    if (scope === 'all') {
                        // Full list (may include inherited models for gateway providers)
                        return getAllModelsForProvider(provider);
                    }

                    // Curated list for UI: keep it small but not single-model-per-provider.
                    return getCuratedModelsForProvider(provider);
                })();

                providers[provider] = {
                    name: displayName,
                    hasApiKey: keyStatus.hasApiKey,
                    primaryEnvVar: keyStatus.envVar,
                    supportsBaseURL: supportsBaseURL(provider),
                    models,
                    supportedFileTypes: info.supportedFileTypes,
                };
            }

            let filtered: Record<string, ProviderCatalog> = { ...providers };

            if (queryParams.provider && queryParams.provider.length > 0) {
                const allowed = new Set(
                    queryParams.provider.filter((p) =>
                        (LLM_PROVIDERS as readonly string[]).includes(p)
                    )
                );
                const filteredByProvider: Record<string, ProviderCatalog> = {};
                for (const [id, catalog] of Object.entries(filtered)) {
                    if (allowed.has(id)) {
                        filteredByProvider[id] = catalog;
                    }
                }
                filtered = filteredByProvider;
            }

            if (typeof queryParams.hasKey === 'boolean') {
                const byKey: Record<string, ProviderCatalog> = {};
                for (const [id, catalog] of Object.entries(filtered)) {
                    if (catalog.hasApiKey === queryParams.hasKey) {
                        byKey[id] = catalog;
                    }
                }
                filtered = byKey;
            }

            if (queryParams.fileType) {
                const byFileType: Record<string, ProviderCatalog> = {};
                for (const [id, catalog] of Object.entries(filtered)) {
                    const models = catalog.models.filter((model) => {
                        const modelTypes =
                            Array.isArray(model.supportedFileTypes) &&
                            model.supportedFileTypes.length > 0
                                ? model.supportedFileTypes
                                : catalog.supportedFileTypes || [];
                        return modelTypes.includes(queryParams.fileType!);
                    });
                    if (models.length > 0) {
                        byFileType[id] = { ...catalog, models };
                    }
                }
                filtered = byFileType;
            }

            if (queryParams.defaultOnly) {
                const byDefault: Record<string, ProviderCatalog> = {};
                for (const [id, catalog] of Object.entries(filtered)) {
                    const models = catalog.models.filter((model) => model.default === true);
                    if (models.length > 0) {
                        byDefault[id] = { ...catalog, models };
                    }
                }
                filtered = byDefault;
            }

            if (queryParams.mode === 'flat') {
                const flat: ModelFlat[] = [];
                for (const [id, catalog] of Object.entries(filtered)) {
                    for (const model of catalog.models) {
                        flat.push({ provider: id as LLMProvider, ...model });
                    }
                }
                return ctx.json({ models: flat });
            }

            return ctx.json({ providers: filtered });
        })
        .openapi(switchRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const raw = ctx.req.valid('json');
            const { sessionId, ...llmUpdates } = raw;

            const config = await agent.switchLLM(llmUpdates, sessionId);

            // Omit apiKey from response for security
            const { apiKey, ...configWithoutKey } = config;
            return ctx.json({
                config: {
                    ...configWithoutKey,
                    hasApiKey: !!apiKey,
                },
                sessionId,
            });
        })
        .openapi(listCustomModelsRoute, async (ctx) => {
            const models = await loadCustomModels();
            return ctx.json({ models });
        })
        .openapi(createCustomModelRoute, async (ctx) => {
            const model = ctx.req.valid('json');
            await saveCustomModel(model);
            return ctx.json({ ok: true as const, model });
        })
        .openapi(deleteCustomModelRoute, async (ctx) => {
            const { name: encodedName } = ctx.req.valid('param');
            // Decode URL-encoded name to handle OpenRouter model IDs with slashes
            const name = decodeURIComponent(encodedName);
            const deleted = await deleteCustomModel(name);
            if (!deleted) {
                throw new DextoRuntimeError(
                    'custom_model_not_found',
                    ErrorScope.LLM,
                    ErrorType.NOT_FOUND,
                    `Custom model '${name}' not found`,
                    { modelName: name }
                );
            }
            return ctx.json({ ok: true as const, deleted: name } as const, 200);
        })
        .openapi(capabilitiesRoute, (ctx) => {
            const { provider, model } = ctx.req.valid('query');

            // getSupportedFileTypesForModel handles:
            // 1. Gateway providers (dexto, openrouter) - resolves via resolveModelOrigin to underlying model
            // 2. Native providers - direct lookup in registry
            // 3. Custom model providers (openai-compatible) - returns provider-level capabilities
            // Falls back to provider-level supportedFileTypes if model not found
            let supportedFileTypes: SupportedFileType[];
            try {
                supportedFileTypes = getSupportedFileTypesForModel(provider, model);
            } catch {
                // If model lookup fails, fall back to provider-level capabilities
                const providerInfo = LLM_REGISTRY[provider];
                supportedFileTypes = providerInfo?.supportedFileTypes ?? [];
            }

            return ctx.json({
                provider,
                model,
                supportedFileTypes,
            });
        });
}
