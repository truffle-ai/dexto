import type { DextoAgentOptions, InitializeServicesOptions } from '@dexto/core';
import type { ValidatedAgentConfig } from '../schemas/agent-config.js';
import type { ResolvedServices } from './types.js';

export interface ToDextoAgentOptionsOptions {
    config: ValidatedAgentConfig;
    services: ResolvedServices;
    overrides?: InitializeServicesOptions | undefined;
}

export function toDextoAgentOptions(options: ToDextoAgentOptionsOptions): DextoAgentOptions {
    const { config, services, overrides } = options;

    return {
        agentId: config.agentId,
        llm: config.llm,
        systemPrompt: config.systemPrompt,
        agentCard: config.agentCard,
        greeting: config.greeting,
        telemetry: config.telemetry,
        memories: config.memories,
        mcpServers: config.mcpServers,
        sessions: config.sessions,
        toolConfirmation: config.toolConfirmation,
        elicitation: config.elicitation,
        internalResources: config.internalResources,
        prompts: config.prompts,
        compaction: config.compaction,
        logger: services.logger,
        storage: services.storage,
        tools: services.tools,
        plugins: services.plugins,
        ...(overrides ? { overrides } : {}),
    };
}
