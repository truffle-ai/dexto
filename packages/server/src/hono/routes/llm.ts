import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DextoRuntimeError, ErrorScope, ErrorType, logger } from '@dexto/core';
import {
    LLM_REGISTRY,
    LLM_PROVIDERS,
    SUPPORTED_FILE_TYPES,
    supportsBaseURL,
    getAllModelsForProvider,
    getCuratedModelsForProvider,
    getCuratedModelRefsForProviders,
    getSupportedFileTypesForModel,
    getLocalModelById,
    getReasoningProfile,
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
    loadModelPickerState,
    saveModelPickerState,
    recordRecentModel,
    toggleFavoriteModel,
    setFavoriteModels,
    pruneModelPickerState,
    toModelPickerKey,
    getAllInstalledModels,
    CustomModelSchema,
    isDextoAuthEnabled,
} from '@dexto/agent-management';
import {
    BadRequestErrorResponse,
    ConflictErrorResponse,
    InternalErrorResponse,
    ProviderCatalogSchema,
    ModelFlatSchema,
    LLMConfigResponseSchema,
    NotFoundErrorResponse,
    StandardErrorEnvelopeSchema,
} from '../schemas/responses.js';
import type { GetAgentFn, OpenAPIRouteSchema } from '../types.js';
const MODEL_PICKER_FEATURED_LIMIT = 8;

const CurrentQuerySchema = z
    .object({
        sessionId: z
            .string()
            .optional()
            .describe('Session identifier to retrieve session-specific LLM configuration'),
    })
    .strict()
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
            .describe('Filter by supported file type (audio, pdf, image, video, or document)'),
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
    .strict()
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

const ModelPickerModelRefSchema = z
    .object({
        provider: z.enum(LLM_PROVIDERS).describe('LLM provider'),
        model: z.string().trim().min(1).describe('Model ID'),
        baseURL: z.string().trim().url().optional().describe('Variant-specific base URL'),
    })
    .strict()
    .describe('Provider/model pair for model picker state operations');

const ModelPickerEntrySchema = z
    .object({
        provider: z.enum(LLM_PROVIDERS).describe('LLM provider'),
        model: z.string().describe('Model ID'),
        baseURL: z.string().url().optional().describe('Variant-specific base URL'),
        displayName: z.string().optional().describe('Human-readable model name'),
        supportedFileTypes: z
            .array(z.enum(SUPPORTED_FILE_TYPES))
            .describe('File types supported by this model'),
        source: z
            .enum(['catalog', 'custom', 'local-installed'])
            .describe('Where this model comes from'),
    })
    .strict()
    .describe('Hydrated model picker entry');

const ModelPickerErrorSchema = StandardErrorEnvelopeSchema.describe(
    'Standard error response for model picker endpoints'
);

const ModelPickerErrorResponses = {
    400: {
        description: 'Validation or request error',
        content: {
            'application/json': {
                schema: ModelPickerErrorSchema,
            },
        },
    },
    404: {
        description: 'Resource not found',
        content: {
            'application/json': {
                schema: ModelPickerErrorSchema,
            },
        },
    },
    500: {
        description: 'Internal server error',
        content: {
            'application/json': {
                schema: ModelPickerErrorSchema,
            },
        },
    },
} as const;

const CapabilitiesQuerySchema = z
    .object({
        provider: z.enum(LLM_PROVIDERS).describe('LLM provider name'),
        model: z
            .string()
            .min(1)
            .describe('Model name (supports both native and OpenRouter format)'),
    })
    .strict()
    .describe('Query parameters for model capability lookup');

const SetFavoritesBodySchema = z
    .object({
        favorites: z
            .array(ModelPickerModelRefSchema)
            .describe('Complete list of favorite model references'),
    })
    .strict()
    .describe('Request body for setting favorite models');

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
                                        .describe('Whether requests route through Dexto gateway'),
                                })
                                .describe('Routing information for the current LLM configuration'),
                        })
                        .describe('Response containing current LLM configuration'),
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
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
                                        .partialRecord(z.enum(LLM_PROVIDERS), ProviderCatalogSchema)
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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
    },
});

const capabilitiesRoute = createRoute({
    method: 'get',
    path: '/llm/capabilities',
    summary: 'Get Model Capabilities',
    description:
        'Returns the capabilities (supported file types) for a specific provider/model combination. ' +
        'Handles gateway providers (dexto-nova, openrouter) by resolving to the underlying model capabilities.',
    tags: ['llm'],
    request: {
        query: CapabilitiesQuerySchema,
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
                        reasoning: z
                            .object({
                                capable: z
                                    .boolean()
                                    .describe(
                                        'Whether Dexto considers this provider/model reasoning-capable (derived from registry metadata plus explicit provider/model rules)'
                                    ),
                                paradigm: z
                                    .enum([
                                        'effort',
                                        'adaptive-effort',
                                        'thinking-level',
                                        'budget',
                                        'none',
                                    ])
                                    .describe('Reasoning control paradigm for this model'),
                                variants: z
                                    .array(
                                        z
                                            .object({
                                                id: z
                                                    .string()
                                                    .describe(
                                                        'Native reasoning variant identifier'
                                                    ),
                                                label: z
                                                    .string()
                                                    .describe(
                                                        'Display label for the native reasoning variant'
                                                    ),
                                            })
                                            .strict()
                                    )
                                    .describe('Native reasoning variants exposed to users'),
                                supportedVariants: z
                                    .array(z.string())
                                    .describe(
                                        'Native reasoning variant IDs supported for this model/provider'
                                    ),
                                defaultVariant: z
                                    .string()
                                    .optional()
                                    .describe(
                                        'Default reasoning variant used when no explicit override is set'
                                    ),
                                supportsBudgetTokens: z
                                    .boolean()
                                    .describe(
                                        'Whether this provider/model supports a budgetTokens-style escape hatch'
                                    ),
                            })
                            .strict()
                            .describe(
                                'Reasoning tuning capabilities derived from registry metadata and explicit provider/model rules'
                            ),
                    }),
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
    },
});

const modelPickerStateRoute = createRoute({
    method: 'get',
    path: '/llm/model-picker-state',
    summary: 'Model Picker State',
    description:
        'Returns hydrated Featured, Recents, Favorites, and Custom sections for the model picker.',
    tags: ['llm'],
    responses: {
        200: {
            description: 'Hydrated model picker sections',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            featured: z
                                .array(ModelPickerEntrySchema)
                                .describe('Curated featured models'),
                            recents: z
                                .array(ModelPickerEntrySchema)
                                .describe('Most recently used models'),
                            favorites: z
                                .array(ModelPickerEntrySchema)
                                .describe('User favorited models'),
                            custom: z
                                .array(ModelPickerEntrySchema)
                                .describe('User-defined custom models'),
                        })
                        .strict(),
                },
            },
        },
        400: ModelPickerErrorResponses[400],
        404: ModelPickerErrorResponses[404],
        500: ModelPickerErrorResponses[500],
    },
});

const recordRecentModelRoute = createRoute({
    method: 'post',
    path: '/llm/model-picker-state/recents',
    summary: 'Record Recent Model',
    description: 'Records a model selection in recents.',
    tags: ['llm'],
    request: {
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: ModelPickerModelRefSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Recent model recorded',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            ok: z.literal(true).describe('Success indicator'),
                        })
                        .strict(),
                },
            },
        },
        400: ModelPickerErrorResponses[400],
        404: ModelPickerErrorResponses[404],
        500: ModelPickerErrorResponses[500],
    },
});

const toggleFavoriteModelRoute = createRoute({
    method: 'post',
    path: '/llm/model-picker-state/favorites/toggle',
    summary: 'Toggle Favorite Model',
    description: 'Adds or removes a model from favorites.',
    tags: ['llm'],
    request: {
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: ModelPickerModelRefSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Favorite toggled',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            ok: z.literal(true).describe('Success indicator'),
                            isFavorite: z.boolean().describe('Whether the model is now favorited'),
                        })
                        .strict(),
                },
            },
        },
        400: ModelPickerErrorResponses[400],
        404: ModelPickerErrorResponses[404],
        500: ModelPickerErrorResponses[500],
    },
});

const setFavoritesRoute = createRoute({
    method: 'put',
    path: '/llm/model-picker-state/favorites',
    summary: 'Set Favorite Models',
    description: 'Replaces favorite models list. Used by migration or bulk updates.',
    tags: ['llm'],
    request: {
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: SetFavoritesBodySchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Favorites updated',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            ok: z.literal(true).describe('Success indicator'),
                            count: z
                                .number()
                                .int()
                                .nonnegative()
                                .describe('Number of favorites persisted'),
                        })
                        .strict(),
                },
            },
        },
        400: ModelPickerErrorResponses[400],
        404: ModelPickerErrorResponses[404],
        500: ModelPickerErrorResponses[500],
    },
});

export function createLlmRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const isProviderEnabled = (provider: LLMProvider): boolean =>
        provider !== 'dexto-nova' || isDextoAuthEnabled();

    const dedupeEntries = (entries: Array<z.output<typeof ModelPickerEntrySchema>>) => {
        const seen = new Set<string>();
        const deduped: Array<z.output<typeof ModelPickerEntrySchema>> = [];

        for (const entry of entries) {
            const key = toModelPickerKey(entry);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            deduped.push(entry);
        }

        return deduped;
    };

    const buildModelPickerSections = async () => {
        const byKey = new Map<string, z.output<typeof ModelPickerEntrySchema>>();
        const customSection: Array<z.output<typeof ModelPickerEntrySchema>> = [];
        const hydrateStateEntry = (
            entry: z.output<typeof ModelPickerModelRefSchema>
        ): z.output<typeof ModelPickerEntrySchema> => {
            const providerInfo = LLM_REGISTRY[entry.provider];
            const modelInfo = providerInfo.models.find((model) => model.name === entry.model);
            const supportedFileTypes =
                Array.isArray(modelInfo?.supportedFileTypes) &&
                modelInfo.supportedFileTypes.length > 0
                    ? modelInfo.supportedFileTypes
                    : providerInfo.supportedFileTypes;
            const source: z.output<typeof ModelPickerEntrySchema>['source'] =
                entry.provider === 'local'
                    ? 'local-installed'
                    : entry.baseURL
                      ? 'custom'
                      : 'catalog';

            return {
                provider: entry.provider,
                model: entry.model,
                ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
                displayName: modelInfo?.displayName || entry.model,
                supportedFileTypes,
                source,
            };
        };

        for (const provider of LLM_PROVIDERS) {
            if (!isProviderEnabled(provider)) {
                continue;
            }

            const providerInfo = LLM_REGISTRY[provider];
            for (const model of getAllModelsForProvider(provider)) {
                const supportedFileTypes =
                    Array.isArray(model.supportedFileTypes) && model.supportedFileTypes.length > 0
                        ? model.supportedFileTypes
                        : providerInfo.supportedFileTypes;

                const entry: z.output<typeof ModelPickerEntrySchema> = {
                    provider,
                    model: model.name,
                    displayName: model.displayName || model.name,
                    supportedFileTypes,
                    source: 'catalog',
                };

                const key = toModelPickerKey(entry);
                if (!byKey.has(key)) {
                    byKey.set(key, entry);
                }
            }
        }

        const customModels = await loadCustomModels();
        for (const customModel of customModels) {
            const provider = (customModel.provider ?? 'openai-compatible') as LLMProvider;
            if (!isProviderEnabled(provider)) {
                continue;
            }

            const providerInfo = LLM_REGISTRY[provider];
            const entry: z.output<typeof ModelPickerEntrySchema> = {
                provider,
                model: customModel.name,
                ...(customModel.baseURL ? { baseURL: customModel.baseURL } : {}),
                displayName: customModel.displayName || customModel.name,
                supportedFileTypes: providerInfo?.supportedFileTypes ?? [],
                source: 'custom',
            };

            byKey.set(toModelPickerKey(entry), entry);
            customSection.push(entry);
        }

        const localProviderSupportedFileTypes = LLM_REGISTRY.local.supportedFileTypes;
        const installedLocalModels = await getAllInstalledModels();
        for (const installedModel of installedLocalModels) {
            const modelInfo = getLocalModelById(installedModel.id);
            const entry: z.output<typeof ModelPickerEntrySchema> = {
                provider: 'local',
                model: installedModel.id,
                displayName: modelInfo?.name || installedModel.id,
                supportedFileTypes: localProviderSupportedFileTypes,
                source: 'local-installed',
            };
            byKey.set(toModelPickerKey(entry), entry);
        }

        const featuredProviders = LLM_PROVIDERS.filter((provider) => isProviderEnabled(provider));
        const featured = getCuratedModelRefsForProviders({
            providers: featuredProviders,
            max: MODEL_PICKER_FEATURED_LIMIT,
        })
            .map((ref) => byKey.get(toModelPickerKey(ref)))
            .filter((entry): entry is z.output<typeof ModelPickerEntrySchema> => Boolean(entry));

        const state = await loadModelPickerState();
        for (const entry of [...state.recents, ...state.favorites]) {
            if (!isProviderEnabled(entry.provider)) {
                continue;
            }
            const key = toModelPickerKey(entry);
            if (!byKey.has(key)) {
                byKey.set(key, hydrateStateEntry(entry));
            }
        }
        const pruned = pruneModelPickerState({
            state,
            allowedKeys: new Set(byKey.keys()),
        });

        const shouldPersistPrunedState =
            state.recents.length !== pruned.recents.length ||
            state.favorites.length !== pruned.favorites.length;

        if (shouldPersistPrunedState) {
            void saveModelPickerState(pruned).catch((error) => {
                logger.warn(
                    `Failed to persist pruned model picker state: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            });
        }

        const recents = pruned.recents
            .map((entry) => byKey.get(toModelPickerKey(entry)))
            .filter((entry): entry is z.output<typeof ModelPickerEntrySchema> => Boolean(entry));

        const favorites = pruned.favorites
            .map((entry) => byKey.get(toModelPickerKey(entry)))
            .filter((entry): entry is z.output<typeof ModelPickerEntrySchema> => Boolean(entry));

        return {
            featured: dedupeEntries(featured),
            recents,
            favorites,
            custom: dedupeEntries(customSection),
        };
    };

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

            // With explicit providers, viaDexto is simply whether the provider is 'dexto-nova'
            // Only report viaDexto when the feature is enabled
            const viaDexto = isDextoAuthEnabled() && currentConfig.provider === 'dexto-nova';

            return ctx.json(
                {
                    config: {
                        ...configWithoutKey,
                        hasApiKey: !!apiKey,
                        ...(displayName && { displayName }),
                    },
                    routing: {
                        viaDexto,
                    },
                },
                200
            );
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

            const providers: Partial<Record<LLMProvider, ProviderCatalog>> = {};

            for (const provider of LLM_PROVIDERS) {
                // Skip dexto-nova provider when feature is not enabled
                if (provider === 'dexto-nova' && !isDextoAuthEnabled()) {
                    continue;
                }

                const info = LLM_REGISTRY[provider];
                const displayName =
                    provider === 'dexto-nova'
                        ? 'Dexto Nova'
                        : provider.charAt(0).toUpperCase() + provider.slice(1);
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

            let filtered: Partial<Record<LLMProvider, ProviderCatalog>> = { ...providers };

            if (queryParams.provider && queryParams.provider.length > 0) {
                const allowed = new Set(
                    queryParams.provider.filter((p) =>
                        (LLM_PROVIDERS as readonly string[]).includes(p)
                    )
                );
                const filteredByProvider: Partial<Record<LLMProvider, ProviderCatalog>> = {};
                for (const [id, catalog] of Object.entries(filtered)) {
                    if (allowed.has(id)) {
                        filteredByProvider[id as LLMProvider] = catalog;
                    }
                }
                filtered = filteredByProvider;
            }

            if (typeof queryParams.hasKey === 'boolean') {
                const byKey: Partial<Record<LLMProvider, ProviderCatalog>> = {};
                for (const [id, catalog] of Object.entries(filtered)) {
                    if (catalog.hasApiKey === queryParams.hasKey) {
                        byKey[id as LLMProvider] = catalog;
                    }
                }
                filtered = byKey;
            }

            if (queryParams.fileType) {
                const byFileType: Partial<Record<LLMProvider, ProviderCatalog>> = {};
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
                        byFileType[id as LLMProvider] = { ...catalog, models };
                    }
                }
                filtered = byFileType;
            }

            if (queryParams.defaultOnly) {
                const byDefault: Partial<Record<LLMProvider, ProviderCatalog>> = {};
                for (const [id, catalog] of Object.entries(filtered)) {
                    const models = catalog.models.filter((model) => model.default === true);
                    if (models.length > 0) {
                        byDefault[id as LLMProvider] = { ...catalog, models };
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
                return ctx.json({ models: flat }, 200);
            }

            return ctx.json({ providers: filtered }, 200);
        })
        .openapi(switchRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const raw = ctx.req.valid('json');
            const { sessionId, ...llmUpdates } = raw;

            const config = await agent.switchLLM(llmUpdates, sessionId);

            try {
                await recordRecentModel({
                    provider: config.provider,
                    model: config.model,
                    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
                });
            } catch {
                // Non-blocking: model switch should still succeed even if recent tracking fails
            }

            // Omit apiKey from response for security
            const { apiKey, ...configWithoutKey } = config;
            return ctx.json(
                {
                    config: {
                        ...configWithoutKey,
                        hasApiKey: !!apiKey,
                    },
                    sessionId,
                },
                200
            );
        })
        .openapi(listCustomModelsRoute, async (ctx) => {
            const models = await loadCustomModels();
            return ctx.json({ models }, 200);
        })
        .openapi(createCustomModelRoute, async (ctx) => {
            const model = ctx.req.valid('json');
            await saveCustomModel(model);
            return ctx.json({ ok: true as const, model }, 200);
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
        .openapi(modelPickerStateRoute, async (ctx) => {
            const sections = await buildModelPickerSections();
            return ctx.json(sections, 200);
        })
        .openapi(recordRecentModelRoute, async (ctx) => {
            const modelRef = ctx.req.valid('json');
            await recordRecentModel(modelRef);
            return ctx.json({ ok: true as const }, 200);
        })
        .openapi(toggleFavoriteModelRoute, async (ctx) => {
            const modelRef = ctx.req.valid('json');
            const result = await toggleFavoriteModel(modelRef);
            return ctx.json(
                {
                    ok: true as const,
                    isFavorite: result.isFavorite,
                },
                200
            );
        })
        .openapi(setFavoritesRoute, async (ctx) => {
            const payload = ctx.req.valid('json');
            const state = await setFavoriteModels({
                favorites: payload.favorites,
            });
            return ctx.json(
                {
                    ok: true as const,
                    count: state.favorites.length,
                },
                200
            );
        })
        .openapi(capabilitiesRoute, (ctx) => {
            const { provider, model } = ctx.req.valid('query');

            // getSupportedFileTypesForModel handles:
            // 1. Gateway providers (dexto-nova, openrouter) - resolves via resolveModelOrigin to underlying model
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

            const reasoning = getReasoningProfile(provider, model);

            return ctx.json(
                {
                    provider,
                    model,
                    supportedFileTypes,
                    reasoning,
                },
                200
            );
        });
}

type CurrentRouteSchema = OpenAPIRouteSchema<
    typeof currentRoute,
    { query: z.input<typeof CurrentQuerySchema> }
>;
type CatalogRouteSchema = OpenAPIRouteSchema<
    typeof catalogRoute,
    { query: z.input<typeof CatalogQuerySchema> }
>;
type SwitchRouteSchema = OpenAPIRouteSchema<
    typeof switchRoute,
    { json: z.input<typeof SwitchLLMBodySchema> }
>;
type ListCustomModelsRouteSchema = OpenAPIRouteSchema<typeof listCustomModelsRoute, {}>;
type CreateCustomModelRouteSchema = OpenAPIRouteSchema<
    typeof createCustomModelRoute,
    { json: z.input<typeof CustomModelSchema> }
>;
type DeleteCustomModelRouteSchema = OpenAPIRouteSchema<
    typeof deleteCustomModelRoute,
    { param: { name: string } }
>;
type CapabilitiesRouteSchema = OpenAPIRouteSchema<
    typeof capabilitiesRoute,
    { query: z.input<typeof CapabilitiesQuerySchema> }
>;
type ModelPickerStateRouteSchema = OpenAPIRouteSchema<typeof modelPickerStateRoute, {}>;
type RecordRecentModelRouteSchema = OpenAPIRouteSchema<
    typeof recordRecentModelRoute,
    { json: z.input<typeof ModelPickerModelRefSchema> }
>;
type ToggleFavoriteModelRouteSchema = OpenAPIRouteSchema<
    typeof toggleFavoriteModelRoute,
    { json: z.input<typeof ModelPickerModelRefSchema> }
>;
type SetFavoritesRouteSchema = OpenAPIRouteSchema<
    typeof setFavoritesRoute,
    { json: z.input<typeof SetFavoritesBodySchema> }
>;

export type LlmRouterSchema =
    | CurrentRouteSchema
    | CatalogRouteSchema
    | SwitchRouteSchema
    | ListCustomModelsRouteSchema
    | CreateCustomModelRouteSchema
    | DeleteCustomModelRouteSchema
    | CapabilitiesRouteSchema
    | ModelPickerStateRouteSchema
    | RecordRecentModelRouteSchema
    | ToggleFavoriteModelRouteSchema
    | SetFavoritesRouteSchema;
