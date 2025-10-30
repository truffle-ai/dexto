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
import { getProviderKeyStatus, saveProviderApiKey } from '@dexto/core';

const CurrentQuerySchema = z.object({
    sessionId: z.string().optional(),
});

const CatalogQuerySchema = z.object({
    provider: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value): string[] | undefined =>
            Array.isArray(value) ? value : value ? value.split(',') : undefined
        ),
    hasKey: z
        .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
        .optional()
        .transform((raw): boolean | undefined =>
            raw === 'true' || raw === '1'
                ? true
                : raw === 'false' || raw === '0'
                  ? false
                  : undefined
        ),
    router: z.enum(LLM_ROUTERS).optional(),
    fileType: z.enum(SUPPORTED_FILE_TYPES).optional(),
    defaultOnly: z
        .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
        .optional()
        .transform((raw): boolean | undefined =>
            raw === 'true' || raw === '1'
                ? true
                : raw === 'false' || raw === '0'
                  ? false
                  : undefined
        ),
    mode: z.enum(['grouped', 'flat']).default('grouped'),
});

const SaveKeySchema = z.object({
    provider: z.enum(LLM_PROVIDERS),
    apiKey: z.string().min(1, 'API key is required'),
});

const SessionIdEnvelopeSchema = z
    .object({
        sessionId: z.string().optional(),
    })
    .passthrough();

export function createLlmRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const currentRoute = createRoute({
        method: 'get',
        path: '/llm/current',
        tags: ['llm'],
        request: { query: CurrentQuerySchema },
        responses: {
            200: {
                description: 'Current LLM config',
                content: { 'application/json': { schema: z.any() } },
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

        return ctx.json({
            config: { ...currentConfig, ...(displayName ? { displayName } : {}) },
        });
    });

    const catalogRoute = createRoute({
        method: 'get',
        path: '/llm/catalog',
        tags: ['llm'],
        request: { query: CatalogQuerySchema },
        responses: {
            200: {
                description: 'LLM catalog',
                content: { 'application/json': { schema: z.any() } },
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
        tags: ['llm'],
        request: { body: { content: { 'application/json': { schema: SaveKeySchema } } } },
        responses: {
            200: {
                description: 'API key saved',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(saveKeyRoute, async (ctx) => {
        const { provider, apiKey } = ctx.req.valid('json');
        const meta = await saveProviderApiKey(provider, apiKey, process.cwd());
        return ctx.json({ ok: true, provider, envVar: meta.envVar });
    });

    // Match Express: SwitchLLMBodySchema uses .passthrough() to allow sessionId + any LLM config fields
    // Since OpenAPI doesn't support passthrough well, we use z.any() and validate manually
    const switchRoute = createRoute({
        method: 'post',
        path: '/llm/switch',
        tags: ['llm'],
        responses: {
            200: {
                description: 'LLM switch result',
                content: { 'application/json': { schema: z.any() } },
            },
        },
        request: { body: { content: { 'application/json': { schema: z.any() } } } },
    });
    app.openapi(switchRoute, async (ctx) => {
        const agent = getAgent();
        // Parse body: extract sessionId and validate remaining fields as LLMUpdatesSchema
        // Matches Express: SwitchLLMBodySchema.passthrough() allows sessionId + any LLM fields
        const raw = ctx.req.valid('json');
        const { sessionId } = SessionIdEnvelopeSchema.parse(raw);
        const { sessionId: _omit, ...llmCandidate } = raw as Record<string, unknown>;
        const llmConfig = LLMUpdatesSchema.parse(llmCandidate);
        const config = await agent.switchLLM(llmConfig, sessionId);
        return ctx.json({ config, sessionId });
    });

    return app;
}
