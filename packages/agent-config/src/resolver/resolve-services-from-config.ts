import { z } from 'zod';
import type { DextoPlugin } from '@dexto/core';
import type { ValidatedAgentConfig, ToolFactoryEntry } from '../schemas/agent-config.js';
import type { DextoImageModule } from '../image/types.js';
import type { ResolvedServices } from './types.js';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function coercePluginPriority(config: unknown): number {
    if (!isPlainObject(config)) {
        throw new Error('Invalid plugin config: expected an object');
    }
    const priority = config.priority;
    if (typeof priority !== 'number' || !Number.isInteger(priority)) {
        throw new Error('Invalid plugin config: priority must be an integer');
    }
    return priority;
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
        blob: blobFactory.create(blobConfig, logger),
        database: databaseFactory.create(databaseConfig, logger),
        cache: cacheFactory.create(cacheConfig, logger),
    };

    // 3) Tools
    const toolEntries = config.tools ?? image.defaults?.tools ?? [];
    const tools = toolEntries.flatMap((entry) => {
        if (entry.enabled === false) {
            return [];
        }

        const factory = resolveByType({
            kind: 'tool',
            type: entry.type,
            factories: image.tools,
            imageName,
        });

        const validatedConfig = factory.configSchema.parse(stripEnabled(entry));
        return factory.create(validatedConfig);
    });

    // 4) Plugins (built-ins only for now)
    if (config.plugins.custom.length > 0 || config.plugins.registry.length > 0) {
        throw new Error(
            'Custom/registry plugins are not supported by the image resolver. Use image-provided plugins instead.'
        );
    }

    const pluginEntries: Array<{ type: string; config: unknown; priority: number }> = [];

    const contentPolicyConfig = config.plugins.contentPolicy;
    if (contentPolicyConfig && (contentPolicyConfig as { enabled?: boolean }).enabled !== false) {
        pluginEntries.push({
            type: 'content-policy',
            config: contentPolicyConfig,
            priority: coercePluginPriority(contentPolicyConfig),
        });
    }

    const responseSanitizerConfig = config.plugins.responseSanitizer;
    if (
        responseSanitizerConfig &&
        (responseSanitizerConfig as { enabled?: boolean }).enabled !== false
    ) {
        pluginEntries.push({
            type: 'response-sanitizer',
            config: responseSanitizerConfig,
            priority: coercePluginPriority(responseSanitizerConfig),
        });
    }

    const plugins: DextoPlugin[] = [];
    pluginEntries.sort((a, b) => a.priority - b.priority);
    for (const entry of pluginEntries) {
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
        plugins.push(plugin);
    }

    // 5) Compaction
    let compaction: ResolvedServices['compaction'] = undefined;
    if (config.compaction.enabled !== false) {
        const factory = resolveByType({
            kind: 'compaction',
            type: config.compaction.type,
            factories: image.compaction,
            imageName,
        });

        try {
            const parsedConfig = factory.configSchema.parse(config.compaction);
            compaction = factory.create(parsedConfig);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw error;
            }
            throw error;
        }
    }

    return { logger, storage, tools, plugins, compaction };
}
