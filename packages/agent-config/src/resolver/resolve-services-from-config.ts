import type { DextoPlugin } from '@dexto/core';
import type { ValidatedAgentConfig } from '../schemas/agent-config.js';
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

// Tool factory entries share `enabled?: boolean` (see A+B+C semantics in the plan).
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

    // 4) Plugins
    const pluginEntries = config.plugins ?? image.defaults?.plugins ?? [];
    const plugins: DextoPlugin[] = [];
    for (const entry of pluginEntries) {
        if ((entry as { enabled?: boolean }).enabled === false) {
            continue;
        }

        const factory = resolveByType({
            kind: 'plugin',
            type: entry.type,
            factories: image.plugins,
            imageName,
        });

        const parsedConfig = factory.configSchema.parse(stripEnabled(entry as PlainObject));
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

    return { logger, storage, tools, plugins, compaction };
}
