import type { AgentConfig, DextoImage } from '@dexto/agent-config';
import {
    AgentConfigSchema,
    applyImageDefaults,
    cleanNullValues,
    loadImage,
    resolveServicesFromConfig,
    resolveToolsFromEntries,
    toDextoAgentOptions,
    type ToolFactoryEntry,
} from '@dexto/agent-config';
import { DextoAgent, logger, type InitializeServicesOptions } from '@dexto/core';
import { enrichAgentConfig, type EnrichAgentConfigOptions } from './config/index.js';
import { BUILTIN_TOOL_NAMES } from '@dexto/tools-builtins';

type CreateDextoAgentFromConfigOptions = {
    config: AgentConfig;
    configPath?: string | undefined;
    enrichOptions?: EnrichAgentConfigOptions | undefined;
    agentIdOverride?: string | undefined;
    imageNameOverride?: string | undefined;
    agentContext?: 'subagent' | undefined;
    overrides?: InitializeServicesOptions | undefined;
};

async function loadImageForConfig(options: {
    config: AgentConfig;
    imageNameOverride?: string | undefined;
}): Promise<{ imageName: string; image: DextoImage }> {
    const { config, imageNameOverride } = options;
    const imageName =
        imageNameOverride ?? config.image ?? process.env.DEXTO_IMAGE ?? '@dexto/image-local';

    try {
        const image = await loadImage(imageName);
        logger.debug(`Loaded image: ${imageName}`);
        return { imageName, image };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load image '${imageName}': ${message}`);
    }
}

function applySubAgentToolConstraints(config: AgentConfig): AgentConfig {
    const tools = config.tools;
    if (!Array.isArray(tools)) {
        return config;
    }

    const disabledBuiltinTools = new Set(['ask_user', 'invoke_skill']);

    const constrainedTools = tools
        // Prevent nested spawning.
        .filter((entry) => entry.type !== 'agent-spawner')
        .map((entry) => {
            if (entry.type !== 'builtin-tools' || entry.enabled === false) {
                return entry;
            }

            const maybeEnabledTools = (entry as { enabledTools?: unknown }).enabledTools;
            const enabledTools = Array.isArray(maybeEnabledTools)
                ? (maybeEnabledTools as string[])
                : [...BUILTIN_TOOL_NAMES];

            const filteredEnabledTools = enabledTools.filter((t) => !disabledBuiltinTools.has(t));

            return { ...entry, enabledTools: filteredEnabledTools };
        })
        // Drop builtin-tools entirely if nothing remains.
        .filter((entry) => {
            if (entry.type !== 'builtin-tools') {
                return true;
            }

            const maybeEnabledTools = (entry as { enabledTools?: unknown }).enabledTools;
            return !Array.isArray(maybeEnabledTools) || maybeEnabledTools.length > 0;
        });

    return { ...config, tools: constrainedTools };
}

export async function createDextoAgentFromConfig(
    options: CreateDextoAgentFromConfigOptions
): Promise<DextoAgent> {
    const { configPath, enrichOptions, agentIdOverride, overrides } = options;

    const cleanedConfig = cleanNullValues(options.config);
    const { image } = await loadImageForConfig({
        config: cleanedConfig,
        imageNameOverride: options.imageNameOverride,
    });

    let configWithImageDefaults = applyImageDefaults(cleanedConfig, image.defaults);
    if (options.agentContext === 'subagent') {
        configWithImageDefaults = applySubAgentToolConstraints(configWithImageDefaults);
    }

    // Enrich config with per-agent paths BEFORE validation (logger/storage paths, prompt/plugin discovery, etc.)
    // Note: agentId override (when provided) is applied after enrichment to force pool/runtime IDs.
    const enrichedConfig = enrichAgentConfig(
        configWithImageDefaults,
        configPath,
        enrichOptions ?? {}
    );
    if (agentIdOverride !== undefined) {
        enrichedConfig.agentId = agentIdOverride;
    }

    const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
    const services = await resolveServicesFromConfig(validatedConfig, image);
    const toolkitLoader =
        overrides?.toolkitLoader ??
        (async (toolkits: string[]) => {
            const entries: ToolFactoryEntry[] = toolkits.map((type) => ({ type }));
            return resolveToolsFromEntries({ entries, image, logger: services.logger });
        });
    const mergedOverrides: InitializeServicesOptions | undefined = {
        ...(overrides ?? {}),
        toolkitLoader,
    };

    return new DextoAgent(
        toDextoAgentOptions({
            config: validatedConfig,
            services,
            overrides: mergedOverrides,
        })
    );
}
