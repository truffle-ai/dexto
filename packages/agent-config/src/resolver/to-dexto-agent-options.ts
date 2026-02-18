import type { DextoAgentOptions, InitializeServicesOptions } from '@dexto/core';
import type { ValidatedAgentConfig } from '../schemas/agent-config.js';
import type { ResolvedServices } from './types.js';

export interface ToDextoAgentOptionsInput {
    config: ValidatedAgentConfig;
    services: ResolvedServices;
    overrides?: InitializeServicesOptions | undefined;
}

export function toDextoAgentOptions(options: ToDextoAgentOptionsInput): DextoAgentOptions {
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
        permissions: config.permissions,
        elicitation: config.elicitation,
        resources: config.resources,
        prompts: config.prompts,
        logger: services.logger,
        storage: services.storage,
        tools: services.tools,
        hooks: services.hooks,
        compaction: services.compaction,
        ...(overrides ? { overrides } : {}),
    };
}
