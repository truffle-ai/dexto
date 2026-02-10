import type { AgentConfig, DextoImageModule } from '@dexto/agent-config';
import {
    AgentConfigSchema,
    applyImageDefaults,
    cleanNullValues,
    loadImage,
    resolveServicesFromConfig,
    toDextoAgentOptions,
} from '@dexto/agent-config';
import { DextoAgent, logger } from '@dexto/core';
import { enrichAgentConfig, type EnrichAgentConfigOptions } from './config/index.js';

type CreateDextoAgentFromConfigOptions = {
    config: AgentConfig;
    configPath?: string | undefined;
    enrichOptions?: EnrichAgentConfigOptions | undefined;
    agentIdOverride?: string | undefined;
    imageNameOverride?: string | undefined;
};

async function loadImageForConfig(options: {
    config: AgentConfig;
    imageNameOverride?: string | undefined;
}): Promise<{ imageName: string; image: DextoImageModule }> {
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

export async function createDextoAgentFromConfig(
    options: CreateDextoAgentFromConfigOptions
): Promise<DextoAgent> {
    const { configPath, enrichOptions, agentIdOverride } = options;

    const cleanedConfig = cleanNullValues(options.config);
    const { image } = await loadImageForConfig({
        config: cleanedConfig,
        imageNameOverride: options.imageNameOverride,
    });

    const configWithImageDefaults = applyImageDefaults(cleanedConfig, image.defaults);

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

    return new DextoAgent(
        toDextoAgentOptions({
            config: validatedConfig,
            services,
            configPath,
        })
    );
}
