import type { Hook } from '@dexto/core';
import type { ValidatedAgentConfig } from '../schemas/agent-config.js';
import type { DextoImageModule } from '../image/types.js';
import type { ResolvedServices } from './types.js';
import type { PlainObject } from './utils.js';
import { isPlainObject } from './utils.js';

const MCP_TOOL_PREFIX = 'mcp--';

// Tool/hook factory entries share `enabled?: boolean`.
// Since many factory schemas are `.strict()`, strip `enabled` before validating the entry.
function stripEnabled(entry: PlainObject): PlainObject {
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
        for (const tool of factory.create(validatedConfig)) {
            if (tool.id.startsWith(MCP_TOOL_PREFIX)) {
                throw new Error(
                    `Invalid local tool id '${tool.id}': '${MCP_TOOL_PREFIX}' prefix is reserved for MCP tools.`
                );
            }

            if (toolIds.has(tool.id)) {
                logger.warn(`Tool id conflict for '${tool.id}'. Skipping duplicate tool.`);
                continue;
            }
            toolIds.add(tool.id);
            tools.push(tool);
        }
    }

    // 4) Hooks
    const hookEntries = config.hooks ?? image.defaults?.hooks ?? [];
    const hooks: Hook[] = [];
    for (const entry of hookEntries) {
        if ((entry as { enabled?: boolean }).enabled === false) {
            continue;
        }

        const factory = resolveByType({
            kind: 'hook',
            type: entry.type,
            factories: image.hooks,
            imageName,
        });

        const parsedConfig = factory.configSchema.parse(stripEnabled(entry as PlainObject));
        const hook = factory.create(parsedConfig);
        if (hook.initialize) {
            if (!isPlainObject(parsedConfig)) {
                throw new Error(`Invalid hook config for '${entry.type}': expected an object`);
            }
            await hook.initialize(parsedConfig);
        }

        hooks.push(hook);
    }

    // 5) Compaction
    const compactionConfig = config.compaction;
    let compaction: ResolvedServices['compaction'] = null;
    if (compactionConfig.enabled !== false) {
        const factory = resolveByType({
            kind: 'compaction',
            type: compactionConfig.type,
            factories: image.compaction,
            imageName,
        });
        const parsedConfig = factory.configSchema.parse(compactionConfig);
        compaction = await factory.create(parsedConfig);
    }

    return { logger, storage, tools, hooks, compaction };
}
