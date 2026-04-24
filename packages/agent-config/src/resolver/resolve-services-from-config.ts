import type { Hook, Logger, Tool } from '@dexto/core';
import type { ToolFactoryEntry, ValidatedAgentConfig } from '../schemas/agent-config.js';
import type { DextoHostContext, DextoImage, ImageResolutionContext } from '../image/types.js';
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

export async function resolveServicesFromConfig<
    THostContext extends DextoHostContext = DextoHostContext,
>(
    config: ValidatedAgentConfig,
    image: DextoImage<THostContext>,
    hostContext?: THostContext
): Promise<ResolvedServices> {
    const imageName = image.metadata.name;
    const resolutionContext: ImageResolutionContext<THostContext> = {
        agentId: config.agentId,
        ...(hostContext ? { hostContext } : {}),
    };

    // 1) Logger
    const loggerFactoryInput = {
        agentId: config.agentId,
        config: config.logger,
    };
    const loggerConfig = image.logger.configSchema.parse(loggerFactoryInput);
    const logger = image.logger.create(loggerConfig, resolutionContext);

    // 2) Storage
    const storageConfig = image.storage.configSchema.parse(config.storage);
    const stores = await image.storage.createStores(storageConfig, logger, resolutionContext);

    // 3) Tools
    const toolEntries = config.tools ?? image.defaults?.tools ?? [];
    const tools = resolveToolsFromEntries({
        entries: toolEntries,
        image,
        logger,
        resolutionContext,
    });
    const toolkitLoader = async (toolkits: string[]) => {
        const entries: ToolFactoryEntry[] = toolkits.map((type) => ({ type }));
        return resolveToolsFromEntries({
            entries,
            image,
            logger,
            resolutionContext,
        });
    };

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
        const hook = factory.create(parsedConfig, resolutionContext);
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
        compaction = await factory.create(parsedConfig, resolutionContext);
    }

    return { logger, stores, tools, toolkitLoader, hooks, compaction };
}

export function resolveToolsFromEntries<
    THostContext extends DextoHostContext = DextoHostContext,
>(options: {
    entries: ToolFactoryEntry[];
    image: DextoImage<THostContext>;
    logger: Logger;
    resolutionContext?: ImageResolutionContext<THostContext> | undefined;
}): Tool[] {
    const { entries, image, logger, resolutionContext } = options;
    const imageName = image.metadata.name;
    const tools: Tool[] = [];
    const toolIds = new Set<string>();

    for (const entry of entries) {
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
        for (const tool of factory.create(validatedConfig, resolutionContext)) {
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

    return tools;
}
