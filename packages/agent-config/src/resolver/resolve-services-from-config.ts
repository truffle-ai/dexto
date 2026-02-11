import type { DextoPlugin, IDextoLogger, PluginExecutionContext, PluginResult } from '@dexto/core';
import type { ValidatedAgentConfig, ToolFactoryEntry } from '../schemas/agent-config.js';
import type { DextoImageModule } from '../image/types.js';
import type { ResolvedServices } from './types.js';
import type { PlainObject } from './utils.js';
import { isPlainObject } from './utils.js';

const INTERNAL_TOOL_PREFIX = 'internal--';
const CUSTOM_TOOL_PREFIX = 'custom--';

function qualifyToolId(prefix: string, id: string): string {
    if (id.startsWith(INTERNAL_TOOL_PREFIX) || id.startsWith(CUSTOM_TOOL_PREFIX)) {
        return id;
    }
    return `${prefix}${id}`;
}

function wrapPluginWithBlockingBehavior(options: {
    name: string;
    plugin: DextoPlugin;
    blocking: boolean;
    logger: IDextoLogger;
}): DextoPlugin & { name: string } {
    const { name, plugin, blocking, logger } = options;

    const coerceResult = (result: PluginResult): PluginResult => {
        if (blocking) {
            return result;
        }
        return {
            ...result,
            cancel: false,
        };
    };

    const wrap = <TPayload extends object>(
        fn: (payload: TPayload, context: PluginExecutionContext) => Promise<PluginResult>
    ) => {
        return async (
            payload: TPayload,
            context: PluginExecutionContext
        ): Promise<PluginResult> => {
            try {
                const result = await fn(payload, context);
                return coerceResult(result);
            } catch (error) {
                if (blocking) {
                    throw error;
                }

                logger.warn(`Non-blocking plugin '${name}' threw error`, {
                    error: error instanceof Error ? error.message : String(error),
                });

                return {
                    ok: false,
                    cancel: false,
                    message: error instanceof Error ? error.message : String(error),
                };
            }
        };
    };

    const wrapped: DextoPlugin & { name: string } = {
        name,
    };

    if (plugin.beforeLLMRequest) {
        wrapped.beforeLLMRequest = wrap(plugin.beforeLLMRequest.bind(plugin));
    }
    if (plugin.beforeToolCall) {
        wrapped.beforeToolCall = wrap(plugin.beforeToolCall.bind(plugin));
    }
    if (plugin.afterToolResult) {
        wrapped.afterToolResult = wrap(plugin.afterToolResult.bind(plugin));
    }
    if (plugin.beforeResponse) {
        wrapped.beforeResponse = wrap(plugin.beforeResponse.bind(plugin));
    }
    if (plugin.cleanup) {
        wrapped.cleanup = plugin.cleanup.bind(plugin);
    }

    return wrapped;
}

// Tool factory entries share `enabled?: boolean` (see A+B+C semantics in the plan).
// Since many factory schemas are `.strict()`, strip `enabled` before validating the entry.
function stripEnabled(entry: ToolFactoryEntry): PlainObject {
    const obj = entry as PlainObject;
    if (!Object.prototype.hasOwnProperty.call(obj, 'enabled')) {
        return obj;
    }

    const { enabled: _enabled, ...rest } = obj;
    return rest;
}

function resolveByType<TFactory>(options: {
    kind: string;
    type: string;
    factories: Record<string, TFactory>;
    imageName: string;
}): TFactory {
    const { kind, type, factories, imageName } = options;
    const factory = factories[type];
    if (!factory) {
        const available = Object.keys(factories).sort();
        throw new Error(
            `Unknown ${kind} type '${type}'. Available types from image '${imageName}': ${available.join(', ')}`
        );
    }
    return factory;
}

type BuiltInPluginConfig = {
    priority: number;
    enabled?: boolean;
    blocking?: boolean;
} & Record<string, unknown>;

function coerceBuiltInPluginConfig(config: unknown, pluginName: string): BuiltInPluginConfig {
    if (!isPlainObject(config)) {
        throw new Error(`Invalid plugin config for '${pluginName}': expected an object`);
    }
    const priority = config.priority;
    if (typeof priority !== 'number' || !Number.isInteger(priority)) {
        throw new Error(`Invalid plugin config for '${pluginName}': priority must be an integer`);
    }
    return config as BuiltInPluginConfig;
}

export async function resolveServicesFromConfig(
    config: ValidatedAgentConfig,
    image: DextoImageModule
): Promise<ResolvedServices> {
    const imageName = image.metadata.name;

    // 1) Logger
    const loggerFactoryInput = {
        agentId: config.agentId,
        config: config.logger,
    };
    const loggerConfig = image.logger.configSchema.parse(loggerFactoryInput);
    const logger = image.logger.create(loggerConfig);

    // 2) Storage
    const blobFactory = resolveByType({
        kind: 'blob storage',
        type: config.storage.blob.type,
        factories: image.storage.blob,
        imageName,
    });
    const databaseFactory = resolveByType({
        kind: 'database',
        type: config.storage.database.type,
        factories: image.storage.database,
        imageName,
    });
    const cacheFactory = resolveByType({
        kind: 'cache',
        type: config.storage.cache.type,
        factories: image.storage.cache,
        imageName,
    });

    const blobConfig = blobFactory.configSchema.parse(config.storage.blob);
    const databaseConfig = databaseFactory.configSchema.parse(config.storage.database);
    const cacheConfig = cacheFactory.configSchema.parse(config.storage.cache);

    const storage = {
        blob: await blobFactory.create(blobConfig, logger),
        database: await databaseFactory.create(databaseConfig, logger),
        cache: await cacheFactory.create(cacheConfig, logger),
    };

    // 3) Tools
    const toolEntries = config.tools ?? image.defaults?.tools ?? [];
    const tools: ResolvedServices['tools'] = [];
    const toolIds = new Set<string>();

    for (const entry of toolEntries) {
        if (entry.enabled === false) {
            continue;
        }

        const factory = resolveByType({
            kind: 'tool',
            type: entry.type,
            factories: image.tools,
            imageName,
        });

        const validatedConfig = factory.configSchema.parse(stripEnabled(entry));
        const prefix = entry.type === 'builtin-tools' ? INTERNAL_TOOL_PREFIX : CUSTOM_TOOL_PREFIX;
        for (const tool of factory.create(validatedConfig)) {
            const qualifiedId = qualifyToolId(prefix, tool.id);
            if (toolIds.has(qualifiedId)) {
                logger.warn(`Tool id conflict for '${qualifiedId}'. Skipping duplicate tool.`);
                continue;
            }
            toolIds.add(qualifiedId);
            tools.push({ ...tool, id: qualifiedId });
        }
    }

    // 4) Plugins (built-ins only for now)
    const pluginEntries: Array<{
        type: string;
        config: unknown;
        priority: number;
        blocking: boolean;
    }> = [];

    const contentPolicyConfig = config.plugins.contentPolicy;
    if (contentPolicyConfig && (contentPolicyConfig as { enabled?: boolean }).enabled !== false) {
        const cfg = coerceBuiltInPluginConfig(contentPolicyConfig, 'content-policy');
        pluginEntries.push({
            type: 'content-policy',
            config: contentPolicyConfig,
            priority: cfg.priority,
            blocking: cfg.blocking ?? true,
        });
    }

    const responseSanitizerConfig = config.plugins.responseSanitizer;
    if (
        responseSanitizerConfig &&
        (responseSanitizerConfig as { enabled?: boolean }).enabled !== false
    ) {
        const cfg = coerceBuiltInPluginConfig(responseSanitizerConfig, 'response-sanitizer');
        pluginEntries.push({
            type: 'response-sanitizer',
            config: responseSanitizerConfig,
            priority: cfg.priority,
            blocking: cfg.blocking ?? false,
        });
    }

    const plugins: DextoPlugin[] = [];
    const priorities = new Set<number>();
    pluginEntries.sort((a, b) => a.priority - b.priority);
    for (const entry of pluginEntries) {
        if (priorities.has(entry.priority)) {
            throw new Error(
                `Duplicate plugin priority: ${entry.priority}. Each plugin must have a unique priority.`
            );
        }
        priorities.add(entry.priority);

        const factory = resolveByType({
            kind: 'plugin',
            type: entry.type,
            factories: image.plugins,
            imageName,
        });

        const parsedConfig = factory.configSchema.parse(entry.config);
        const plugin = factory.create(parsedConfig);
        if (plugin.initialize) {
            if (!isPlainObject(parsedConfig)) {
                throw new Error(`Invalid plugin config for '${entry.type}': expected an object`);
            }
            await plugin.initialize(parsedConfig);
        }

        plugins.push(
            wrapPluginWithBlockingBehavior({
                name: entry.type,
                plugin,
                blocking: entry.blocking,
                logger,
            })
        );
    }

    return { logger, storage, tools, plugins };
}
