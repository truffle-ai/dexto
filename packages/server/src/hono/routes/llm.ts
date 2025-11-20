import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import {
    LLM_REGISTRY,
    LLM_PROVIDERS,
    LLM_ROUTERS,
    SUPPORTED_FILE_TYPES,
    getSupportedRoutersForProvider,
    supportsBaseURL,
    isRouterSupportedForModel,
    type ProviderInfo,
    type LLMProvider,
    LLMUpdatesSchema,
} from '@dexto/core';
import { getProviderKeyStatus, saveProviderApiKey } from '@dexto/agent-management';
import {
    ProviderCatalogSchema,
    ModelFlatSchema,
    LLMConfigResponseSchema,
} from '../schemas/responses.js';

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
        provider: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .transform((value): string[] | undefined =>
                Array.isArray(value) ? value : value ? value.split(',') : undefined
            )
            .describe('Comma-separated list of LLM providers to filter by'),
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
        router: z
            .enum(LLM_ROUTERS)
            .optional()
            .describe('Filter by router type (vercel or in-built)'),
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

const SaveKeySchema = z
    .object({
        provider: z
            .enum(LLM_PROVIDERS)
            .describe('LLM provider identifier (e.g., openai, anthropic)'),
        apiKey: z
            .string()
            .min(1, 'API key is required')
            .describe('API key for the provider (writeOnly - never returned in responses)')
            .openapi({ writeOnly: true }),
    })
    .describe('Request body for saving a provider API key');

const SessionIdEnvelopeSchema = z
    .object({
        sessionId: z
            .string()
            .optional()
            .describe('Session identifier for session-specific LLM configuration'),
    })
    .describe('Envelope schema for extracting sessionId');

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

export function createLlmRouter(getAgent: () => DextoAgent) {
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
                                    router: true,
                                }).extend({
                                    displayName: z
                                        .string()
                                        .optional()
                                        .describe('Human-readable model display name'),
                                }),
                            })
                            .describe('Response containing current LLM configuration'),
                    },
                },
            },
        },
    });
    app.openapi(currentRoute, (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.valid('query');

        const currentConfig = sessionId
            ? agent.getEffectiveConfig(sessionId).llm
            : agent.getCurrentLLMConfig();

        let displayName: string | undefined;
        try {
            const model = LLM_REGISTRY[currentConfig.provider]?.models.find(
                (m) => m.name.toLowerCase() === String(currentConfig.model).toLowerCase()
            );
            displayName = model?.displayName || undefined;
        } catch {
            // ignore lookup errors
        }

        // Omit apiKey from response for security
        const { apiKey, ...configWithoutKey } = currentConfig;
        return ctx.json({
            config: {
                ...configWithoutKey,
                hasApiKey: !!apiKey,
                ...(displayName && { displayName }),
            },
        });
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
                                            .record(ProviderCatalogSchema)
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
    app.openapi(catalogRoute, (ctx) => {
        type ProviderCatalog = Pick<
            ProviderInfo,
            'supportedRouters' | 'models' | 'supportedFileTypes'
        > & {
            name: string;
            hasApiKey: boolean;
            primaryEnvVar: string;
            supportsBaseURL: boolean;
        };

        type ModelFlat = ProviderCatalog['models'][number] & { provider: LLMProvider };

        const queryParams = ctx.req.valid('query');

        const providers: Record<string, ProviderCatalog> = {};
        for (const provider of LLM_PROVIDERS) {
            const info = LLM_REGISTRY[provider];
            const displayName = provider.charAt(0).toUpperCase() + provider.slice(1);
            const keyStatus = getProviderKeyStatus(provider);

            providers[provider] = {
                name: displayName,
                hasApiKey: keyStatus.hasApiKey,
                primaryEnvVar: keyStatus.envVar,
                supportedRouters: getSupportedRoutersForProvider(provider),
                supportsBaseURL: supportsBaseURL(provider),
                models: info.models,
                supportedFileTypes: info.supportedFileTypes,
            };
        }

        let filtered: Record<string, ProviderCatalog> = { ...providers };

        if (queryParams.provider && queryParams.provider.length > 0) {
            const allowed = new Set(
                queryParams.provider.filter((p) => (LLM_PROVIDERS as readonly string[]).includes(p))
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

        if (queryParams.router) {
            const byRouter: Record<string, ProviderCatalog> = {};
            for (const [id, catalog] of Object.entries(filtered)) {
                if (!catalog.supportedRouters.includes(queryParams.router!)) continue;
                const models = catalog.models.filter((model) =>
                    isRouterSupportedForModel(id as LLMProvider, model.name, queryParams.router!)
                );
                if (models.length > 0) {
                    byRouter[id] = { ...catalog, models };
                }
            }
            filtered = byRouter;
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
    });

    const saveKeyRoute = createRoute({
        method: 'post',
        path: '/llm/key',
        summary: 'Save Provider API Key',
        description: 'Stores an API key for a provider in .env and makes it available immediately',
        tags: ['llm'],
        request: { body: { content: { 'application/json': { schema: SaveKeySchema } } } },
        responses: {
            200: {
                description: 'API key saved',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                ok: z.literal(true).describe('Operation success indicator'),
                                provider: z
                                    .enum(LLM_PROVIDERS)
                                    .describe('Provider for which the key was saved'),
                                envVar: z
                                    .string()
                                    .describe('Environment variable name where key was stored'),
                            })
                            .strict()
                            .describe('API key save response'),
                    },
                },
            },
        },
    });
    app.openapi(saveKeyRoute, async (ctx) => {
        const { provider, apiKey } = ctx.req.valid('json');
        const meta = await saveProviderApiKey(provider, apiKey, process.cwd());
        return ctx.json({ ok: true, provider, envVar: meta.envVar });
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
    app.openapi(switchRoute, async (ctx) => {
        const agent = getAgent();
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
    });

    return app;
}
