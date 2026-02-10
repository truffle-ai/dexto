import type { DextoAgentOptions, InitializeServicesOptions } from '@dexto/core';
import type { ValidatedAgentConfig } from '../schemas/agent-config.js';
import type { ResolvedServices } from './types.js';

export interface ToDextoAgentOptionsOptions {
    config: ValidatedAgentConfig;
    services: ResolvedServices;
    configPath?: string | undefined;
    overrides?: InitializeServicesOptions | undefined;
}

export function toDextoAgentOptions(options: ToDextoAgentOptionsOptions): DextoAgentOptions {
    const { config, services, configPath, overrides } = options;

    const runtimeConfig: DextoAgentOptions['config'] = config;

    return {
        config: runtimeConfig,
        configPath,
        overrides,
        logger: services.logger,
        storage: services.storage,
        tools: services.tools,
        plugins: services.plugins,
        compaction: services.compaction,
    };
}
