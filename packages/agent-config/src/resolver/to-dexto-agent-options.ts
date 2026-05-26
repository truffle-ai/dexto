import type { DextoAgentOptions, InitializeServicesOptions } from '@dexto/core';
import type { DextoHostContext, DextoImage } from '../image/types.js';
import type { ValidatedAgentConfig } from '../schemas/agent-config.js';
import type { ResolvedServices } from './types.js';

export interface ToDextoAgentOptionsInput<
    THostContext extends DextoHostContext = DextoHostContext,
> {
    config: ValidatedAgentConfig;
    services: ResolvedServices;
    image?: DextoImage<THostContext> | undefined;
    hostContext?: THostContext | undefined;
    overrides?: InitializeServicesOptions | undefined;
    runtimeOverrides?: Pick<DextoAgentOptions, 'usageScopeId'> | undefined;
}

export function toDextoAgentOptions<THostContext extends DextoHostContext = DextoHostContext>(
    options: ToDextoAgentOptionsInput<THostContext>
): DextoAgentOptions {
    const { config, services, image, hostContext, overrides, runtimeOverrides } = options;
    const resolvedOverrides =
        services.workspaceHandleProvider !== undefined
            ? {
                  ...(overrides ?? {}),
                  workspaceHandleProvider:
                      overrides?.workspaceHandleProvider ?? services.workspaceHandleProvider,
              }
            : overrides;
    const imageRuntimeConfig = image?.resolveRuntimeConfig?.({
        config,
        context: {
            agentId: config.agentId,
            ...(hostContext ? { hostContext } : {}),
        },
    });

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
        ...(imageRuntimeConfig ?? {}),
        logger: services.logger,
        stores: services.stores,
        tools: services.tools,
        skillSources: services.skillSources,
        toolkitLoader: services.toolkitLoader,
        hooks: services.hooks,
        compaction: services.compaction,
        ...(runtimeOverrides ? runtimeOverrides : {}),
        ...(resolvedOverrides ? { overrides: resolvedOverrides } : {}),
    };
}
