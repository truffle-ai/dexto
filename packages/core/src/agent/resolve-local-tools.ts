import type { IDextoLogger } from '../logger/v2/types.js';
import type { InternalToolsConfig, CustomToolsConfig } from '../tools/schemas.js';
import type { InternalToolsServices } from '../tools/internal-tools/registry.js';
import type { InternalTool } from '../tools/types.js';
import { InternalToolsProvider } from '../tools/internal-tools/provider.js';
import { customToolRegistry, type ToolCreationContext } from '../tools/custom-tool-registry.js';
import { ToolError } from '../tools/errors.js';
import { ToolErrorCode } from '../tools/error-codes.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';

// TODO: temporary glue code to be removed/verified
// During the DI refactor, tool resolution will move out of core into `@dexto/agent-config`.

const INTERNAL_TOOL_PREFIX = 'internal--';
const CUSTOM_TOOL_PREFIX = 'custom--';

export async function resolveLocalToolsFromConfig(options: {
    agent: import('./DextoAgent.js').DextoAgent;
    internalToolsConfig: InternalToolsConfig;
    customToolsConfig: CustomToolsConfig;
    services: InternalToolsServices & Record<string, unknown>;
    logger: IDextoLogger;
}): Promise<InternalTool[]> {
    const { agent, internalToolsConfig, customToolsConfig, services, logger } = options;

    const tools: InternalTool[] = [];
    const seenIds = new Set<string>();

    const qualifyToolId = (prefix: string, id: string): string => {
        if (id.startsWith(INTERNAL_TOOL_PREFIX) || id.startsWith(CUSTOM_TOOL_PREFIX)) {
            return id;
        }
        return `${prefix}${id}`;
    };

    // 1) Internal tools (built-ins)
    if (internalToolsConfig.length > 0) {
        const provider = new InternalToolsProvider(services, internalToolsConfig, logger);
        await provider.initialize();

        for (const toolName of provider.getToolNames()) {
            const tool = provider.getTool(toolName);
            if (!tool) {
                continue;
            }

            const qualifiedId = qualifyToolId(INTERNAL_TOOL_PREFIX, tool.id);
            if (seenIds.has(qualifiedId)) {
                logger.warn(`Tool id conflict for '${qualifiedId}'. Skipping duplicate tool.`);
                continue;
            }

            seenIds.add(qualifiedId);
            tools.push({ ...tool, id: qualifiedId });
        }
    }

    // 2) Custom tools (image/tool providers)
    if (customToolsConfig.length > 0) {
        const context: ToolCreationContext = {
            logger,
            agent,
            services,
        };

        for (const toolConfig of customToolsConfig) {
            try {
                const validatedConfig = customToolRegistry.validateConfig(toolConfig);
                const provider = customToolRegistry.get(validatedConfig.type);
                if (!provider) {
                    const availableTypes = customToolRegistry.getTypes();
                    throw ToolError.unknownCustomToolProvider(validatedConfig.type, availableTypes);
                }

                const providerTools = provider.create(validatedConfig, context);
                for (const tool of providerTools) {
                    const qualifiedId = qualifyToolId(CUSTOM_TOOL_PREFIX, tool.id);
                    if (seenIds.has(qualifiedId)) {
                        logger.warn(
                            `Tool id conflict for '${qualifiedId}'. Skipping duplicate tool.`
                        );
                        continue;
                    }

                    seenIds.add(qualifiedId);
                    tools.push({ ...tool, id: qualifiedId });
                }
            } catch (error) {
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === ToolErrorCode.CUSTOM_TOOL_PROVIDER_UNKNOWN
                ) {
                    throw error;
                }

                logger.error(
                    `Failed to resolve custom tools: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    return tools;
}
