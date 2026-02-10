import type { ToolFactory } from '@dexto/agent-config';
import type { InternalTool, ToolExecutionContext } from '@dexto/core';
import type { ToolCreationContext } from '@dexto/core';
import {
    WaitForInputSchema,
    CheckTaskInputSchema,
    ListTasksInputSchema,
} from '@dexto/orchestration';
import {
    AgentSpawnerConfigSchema,
    SpawnAgentInputSchema,
    type AgentSpawnerConfig,
} from './schemas.js';
import { agentSpawnerToolsProvider } from './tool-provider.js';

type InternalToolWithOptionalExtensions = InternalTool & {
    generatePreview?: InternalTool['generatePreview'];
};

type ToolCreationServices = NonNullable<ToolCreationContext['services']>;

function requireAgentContext(context?: ToolExecutionContext): {
    agent: NonNullable<ToolExecutionContext['agent']>;
    logger: NonNullable<ToolExecutionContext['logger']>;
    services: ToolExecutionContext['services'] | undefined;
} {
    const agent = context?.agent;
    if (!agent) {
        throw new Error(
            'agent-spawner tools require ToolExecutionContext.agent (ToolManager should provide this)'
        );
    }

    const logger = context?.logger;
    if (!logger) {
        throw new Error(
            'agent-spawner tools require ToolExecutionContext.logger (ToolManager should provide this)'
        );
    }

    return { agent, logger, services: context?.services };
}

function createLazyProviderTool(options: {
    id: string;
    description: string;
    inputSchema: InternalTool['inputSchema'];
    getTool: (context?: ToolExecutionContext) => InternalToolWithOptionalExtensions;
}): InternalTool {
    const { id, description, inputSchema, getTool } = options;

    return {
        id,
        description,
        inputSchema,
        execute: (input, context) => getTool(context).execute(input, context),
        generatePreview: async (input, context) => {
            const tool = getTool(context);
            if (!tool.generatePreview) {
                return null;
            }
            return await tool.generatePreview(input, context);
        },
    };
}

export const agentSpawnerToolsFactory: ToolFactory<AgentSpawnerConfig> = {
    configSchema: AgentSpawnerConfigSchema,
    metadata: {
        displayName: 'Agent Spawner',
        description: 'Spawn sub-agents for task delegation',
        category: 'agents',
    },
    create: (config) => {
        let toolMap: Map<string, InternalToolWithOptionalExtensions> | undefined;

        const ensureToolsInitialized = (context?: ToolExecutionContext) => {
            if (toolMap) {
                return toolMap;
            }

            const { agent, logger, services } = requireAgentContext(context);

            // TODO: temporary glue code to be removed/verified (remove-by: 5.1)
            // ToolExecutionContext.services is currently typed as a closed object (approval/search/resources/prompts/mcp),
            // but agent-spawner needs to late-bind `taskForker` for invoke_skill fork support.
            // The existing provider already uses this pattern via a mutable services object; we reuse it here.
            const creationContext: ToolCreationContext = { agent, logger };
            if (services !== undefined) {
                creationContext.services = services as unknown as ToolCreationServices;
            }

            const tools = agentSpawnerToolsProvider.create(config, creationContext);
            toolMap = new Map(tools.map((t) => [t.id, t]));
            return toolMap;
        };

        const getToolById = (id: string, context?: ToolExecutionContext) => {
            const map = ensureToolsInitialized(context);
            const tool = map.get(id);
            if (!tool) {
                throw new Error(`agent-spawner: expected provider tool '${id}' to exist`);
            }
            return tool;
        };

        return [
            createLazyProviderTool({
                id: 'spawn_agent',
                description: 'Spawn a sub-agent to handle a task and return its result.',
                inputSchema: SpawnAgentInputSchema,
                getTool: (context) => getToolById('spawn_agent', context),
            }),
            createLazyProviderTool({
                id: 'wait_for',
                description: 'Wait for background task(s) to complete.',
                inputSchema: WaitForInputSchema,
                getTool: (context) => getToolById('wait_for', context),
            }),
            createLazyProviderTool({
                id: 'check_task',
                description: 'Check the status of a background task.',
                inputSchema: CheckTaskInputSchema,
                getTool: (context) => getToolById('check_task', context),
            }),
            createLazyProviderTool({
                id: 'list_tasks',
                description: 'List background tasks and their statuses.',
                inputSchema: ListTasksInputSchema,
                getTool: (context) => getToolById('list_tasks', context),
            }),
        ];
    },
};
