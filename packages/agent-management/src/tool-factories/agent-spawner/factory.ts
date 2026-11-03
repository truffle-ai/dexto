import type { ToolFactory } from '@dexto/agent-config';
import { TOOL_ACTIVITY, createLocalToolCallHeader, truncateForHeader } from '@dexto/core';
import type { ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';
import {
    AgentSpawnerConfigSchema,
    SpawnAgentInputSchema,
    type AgentSpawnerConfig,
    type SpawnAgentInput,
} from './schemas.js';
import { AgentSpawnerRuntime } from './runtime.js';
import { createSpawnAgentTool } from './spawn-agent-tool.js';

function requireAgentContext(context: ToolExecutionContext): {
    agent: NonNullable<ToolExecutionContext['agent']>;
    logger: ToolExecutionContext['logger'];
    toolServices: NonNullable<ToolExecutionContext['services']>;
} {
    if (!context.agent) {
        throw ToolError.configInvalid('agent-spawner tools require ToolExecutionContext.agent');
    }

    if (!context.services) {
        throw ToolError.configInvalid('agent-spawner tools require ToolExecutionContext.services');
    }

    return { agent: context.agent, logger: context.logger, toolServices: context.services };
}

type InitializedAgentSpawnerTools = {
    spawnAgent: ReturnType<typeof createSpawnAgentTool>;
};

type AgentSpawnerToolState = {
    agent: NonNullable<ToolExecutionContext['agent']>;
    abortController: AbortController;
    runtime: AgentSpawnerRuntime;
    tools: InitializedAgentSpawnerTools;
};

export const agentSpawnerToolsFactory: ToolFactory<AgentSpawnerConfig> = {
    configSchema: AgentSpawnerConfigSchema,
    metadata: {
        displayName: 'Agent Spawner',
        description: 'Spawn sub-agents for task delegation',
        category: 'agents',
    },
    create: (config) => {
        let state: AgentSpawnerToolState | undefined;

        const attachTaskForker = (options: {
            toolServices: NonNullable<ToolExecutionContext['services']>;
            taskForker: AgentSpawnerRuntime;
            logger: ToolExecutionContext['logger'];
        }) => {
            const { toolServices, taskForker, logger } = options;
            if (toolServices.taskForker !== taskForker) {
                toolServices.taskForker = taskForker;
                logger.debug('AgentSpawnerRuntime attached as taskForker');
            }
        };

        const updateWorkspaceRootHint = (
            runtime: AgentSpawnerRuntime,
            context: ToolExecutionContext
        ) => {
            runtime.setWorkspaceRootHint(context.workspace?.path);
        };

        const ensureToolsInitialized = (
            context: ToolExecutionContext
        ): InitializedAgentSpawnerTools => {
            const { agent, logger, toolServices } = requireAgentContext(context);

            if (state && state.agent === agent && !state.abortController.signal.aborted) {
                updateWorkspaceRootHint(state.runtime, context);
                attachTaskForker({ toolServices, taskForker: state.runtime, logger });
                return state.tools;
            }

            if (state && !state.abortController.signal.aborted) {
                state.abortController.abort();
            }

            if (state) {
                state.runtime.cleanup().catch(() => undefined);
            }

            state = undefined;

            // Create the runtime bridge that spawns/executes sub-agents.
            const spawnerRuntime = new AgentSpawnerRuntime(agent, config, logger);
            updateWorkspaceRootHint(spawnerRuntime, context);
            attachTaskForker({ toolServices, taskForker: spawnerRuntime, logger });

            const abortController = new AbortController();
            agent.on(
                'agent:stopped',
                () => {
                    spawnerRuntime.cleanup().catch(() => undefined);
                    abortController.abort();
                },
                { signal: abortController.signal }
            );

            const spawnAgentTool = createSpawnAgentTool(spawnerRuntime);
            const tools: InitializedAgentSpawnerTools = {
                spawnAgent: spawnAgentTool,
            };

            state = {
                agent,
                abortController,
                runtime: spawnerRuntime,
                tools,
            };

            return tools;
        };

        return [
            {
                id: 'spawn_agent',
                description: 'Spawn a sub-agent to handle a task and return its result.',
                getDescription: async (context: ToolExecutionContext) => {
                    const tool = ensureToolsInitialized(context).spawnAgent;
                    if (tool.getDescription) {
                        return await tool.getDescription(context);
                    }
                    return tool.description;
                },
                inputSchema: SpawnAgentInputSchema,
                execute: (input: SpawnAgentInput, context) =>
                    ensureToolsInitialized(context).spawnAgent.execute(input, context),
                presentation: {
                    activity: TOOL_ACTIVITY.runAgent,
                    describeHeader: (input: SpawnAgentInput) => {
                        const agentId =
                            typeof input.agentId === 'string' ? input.agentId : undefined;
                        const agentLabel = agentId ? agentId.replace(/-agent$/, '') : undefined;
                        const title = agentLabel
                            ? agentLabel.charAt(0).toUpperCase() + agentLabel.slice(1)
                            : 'Agent';

                        const task = typeof input.task === 'string' ? input.task : '';
                        const argsText = task ? truncateForHeader(task, 120) : undefined;

                        return createLocalToolCallHeader({
                            title,
                            ...(argsText ? { argsText } : {}),
                        });
                    },
                    preview: async (input: SpawnAgentInput, context) => {
                        const tool = ensureToolsInitialized(context).spawnAgent;
                        const previewFn = tool.presentation?.preview;
                        if (!previewFn) {
                            return null;
                        }
                        return await previewFn(input, context);
                    },
                },
            },
        ];
    },
};
