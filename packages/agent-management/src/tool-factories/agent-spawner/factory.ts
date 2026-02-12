import type { ToolFactory } from '@dexto/agent-config';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { ToolBackgroundEvent } from '@dexto/core';
import {
    ConditionEngine,
    SignalBus,
    TaskRegistry,
    createCheckTaskTool,
    createListTasksTool,
    createWaitForTool,
    WaitForInputSchema,
    CheckTaskInputSchema,
    ListTasksInputSchema,
} from '@dexto/orchestration';
import {
    AgentSpawnerConfigSchema,
    SpawnAgentInputSchema,
    type AgentSpawnerConfig,
} from './schemas.js';
import { AgentSpawnerRuntime } from './runtime.js';
import { createSpawnAgentTool } from './spawn-agent-tool.js';

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

    return { agent, logger, services: context.services };
}

function createLazyTool(options: {
    id: string;
    description: string;
    inputSchema: Tool['inputSchema'];
    getTool: (context?: ToolExecutionContext) => Tool;
}): Tool {
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
        let toolMap: Map<string, Tool> | undefined;
        let runtimeService: AgentSpawnerRuntime | undefined;
        let backgroundAbortController: AbortController | undefined;
        let initializedForAgent: ToolExecutionContext['agent'] | undefined;
        let warnedMissingServices = false;

        const wireTaskForker = (options: {
            services: ToolExecutionContext['services'] | undefined;
            service: AgentSpawnerRuntime;
            logger: NonNullable<ToolExecutionContext['logger']>;
        }) => {
            const { services, service, logger } = options;

            if (services) {
                warnedMissingServices = false;
                if (services.taskForker !== service) {
                    services.taskForker = service;
                    logger.debug(
                        'AgentSpawnerRuntime wired as taskForker for context:fork skill support'
                    );
                }
                return;
            }

            if (!warnedMissingServices) {
                warnedMissingServices = true;
                logger.warn(
                    'Tool execution services not available; forked skills (context: fork) will be disabled'
                );
            }
        };

        const ensureToolsInitialized = (context?: ToolExecutionContext): Map<string, Tool> => {
            const { agent, logger, services } = requireAgentContext(context);

            if (
                toolMap &&
                runtimeService &&
                backgroundAbortController &&
                !backgroundAbortController.signal.aborted &&
                initializedForAgent === agent
            ) {
                wireTaskForker({ services, service: runtimeService, logger });
                return toolMap;
            }

            warnedMissingServices = false;

            if (backgroundAbortController && !backgroundAbortController.signal.aborted) {
                backgroundAbortController.abort();
            }

            if (runtimeService) {
                runtimeService.cleanup().catch(() => undefined);
            }

            initializedForAgent = agent;

            const signalBus = new SignalBus();
            const taskRegistry = new TaskRegistry(signalBus);
            const conditionEngine = new ConditionEngine(taskRegistry, signalBus, logger);

            // Create the runtime bridge that spawns/executes sub-agents.
            const service = new AgentSpawnerRuntime(agent, config, logger);

            runtimeService = service;
            wireTaskForker({ services, service, logger });

            const taskSessions = new Map<string, string>();

            const emitTasksUpdate = (sessionId?: string) => {
                const tasks = taskRegistry.list({
                    status: ['running', 'completed', 'failed', 'cancelled'],
                });
                const scopedTasks = sessionId
                    ? tasks.filter((task) => taskSessions.get(task.taskId) === sessionId)
                    : tasks;
                const runningCount = scopedTasks.filter((task) => task.status === 'running').length;

                agent.emit('service:event', {
                    service: 'orchestration',
                    event: 'tasks-updated',
                    sessionId: sessionId ?? '',
                    data: {
                        runningCount,
                        tasks: scopedTasks.map((task) => ({
                            taskId: task.taskId,
                            status: task.status,
                            ...(task.description !== undefined && {
                                description: task.description,
                            }),
                        })),
                    },
                });
            };

            const triggerBackgroundCompletion = (taskId: string, sessionId?: string) => {
                if (!sessionId) {
                    return;
                }

                agent.emit('tool:background-completed', {
                    toolCallId: taskId,
                    sessionId,
                });

                const taskInfo = taskRegistry.getInfo(taskId);
                const resultText = (() => {
                    if (taskInfo?.status === 'failed') {
                        return taskInfo.error ?? 'Unknown error.';
                    }
                    if (taskInfo?.result !== undefined) {
                        if (typeof taskInfo.result === 'string') {
                            return taskInfo.result;
                        }
                        try {
                            return JSON.stringify(taskInfo.result, null, 2);
                        } catch {
                            return String(taskInfo.result ?? '<unserializable result>');
                        }
                    }
                    return 'No result available.';
                })();

                const sanitizeCdata = (value: string) => value.replace(/\]\]>/g, ']]]]><![CDATA[>');
                const safeDescription = taskInfo?.description
                    ? sanitizeCdata(taskInfo.description)
                    : null;
                const safeResultText = sanitizeCdata(resultText);

                const descriptionTag = safeDescription
                    ? `  <description><![CDATA[${safeDescription}]]></description>\n`
                    : '';

                const statusTag = taskInfo?.status ? `  <status>${taskInfo.status}</status>\n` : '';

                const content = [
                    {
                        type: 'text' as const,
                        text:
                            `<background-task-completion>\n` +
                            `  <origin>task</origin>\n` +
                            `  <note>The following response was reported by the background task (not user input).</note>\n` +
                            `  <taskId>${taskId}</taskId>\n` +
                            statusTag +
                            descriptionTag +
                            `  <result><![CDATA[${safeResultText}]]></result>\n` +
                            `</background-task-completion>`,
                    },
                ];

                agent
                    .isSessionBusy(sessionId)
                    .then((isBusy) => {
                        if (isBusy) {
                            agent
                                .queueMessage(sessionId, {
                                    content,
                                    kind: 'background',
                                })
                                .catch(() => undefined);
                        } else {
                            agent.emit('run:invoke', {
                                sessionId,
                                content,
                                source: 'external',
                                metadata: { taskId },
                            });
                            agent.generate(content, sessionId).catch(() => undefined);
                        }
                    })
                    .catch(() => {
                        // Ignore errors - background completion shouldn't crash flow
                    });
            };

            const handleBackground = (event: ToolBackgroundEvent) => {
                const taskId = event.toolCallId;
                if (taskRegistry.has(taskId)) {
                    return;
                }

                if (event.sessionId) {
                    taskSessions.set(taskId, event.sessionId);
                }

                try {
                    taskRegistry.register(
                        {
                            type: 'generic',
                            taskId,
                            description: event.description ?? `Tool ${event.toolName}`,
                            promise: event.promise,
                        },
                        {
                            ...(event.timeoutMs !== undefined && { timeout: event.timeoutMs }),
                            ...(event.notifyOnComplete !== undefined && {
                                notify: event.notifyOnComplete,
                            }),
                        }
                    );
                } catch (error) {
                    taskSessions.delete(taskId);
                    event.promise.catch(() => undefined);
                    logger.warn(
                        `Failed to register background task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
                        { color: 'yellow' }
                    );
                    return;
                }

                emitTasksUpdate(event.sessionId);

                event.promise.finally(() => {
                    taskSessions.delete(taskId);
                    emitTasksUpdate(event.sessionId);
                    triggerBackgroundCompletion(taskId, event.sessionId);
                });
            };

            backgroundAbortController = new AbortController();
            agent.on('tool:background', handleBackground, {
                signal: backgroundAbortController.signal,
            });
            agent.on(
                'agent:stopped',
                () => {
                    service.cleanup().catch(() => undefined);
                    backgroundAbortController?.abort();
                },
                { signal: backgroundAbortController.signal }
            );

            const spawnAgentTool = createSpawnAgentTool(service);

            const tools = [
                spawnAgentTool,
                createWaitForTool(conditionEngine),
                createCheckTaskTool(taskRegistry),
                createListTasksTool(taskRegistry),
            ];

            toolMap = new Map(tools.map((t) => [t.id, t]));
            return toolMap;
        };

        const getToolById = (id: string, context?: ToolExecutionContext) => {
            const map = ensureToolsInitialized(context);
            const tool = map.get(id);
            if (!tool) {
                throw new Error(`agent-spawner: expected factory tool '${id}' to exist`);
            }
            return tool;
        };

        return [
            createLazyTool({
                id: 'spawn_agent',
                description: 'Spawn a sub-agent to handle a task and return its result.',
                inputSchema: SpawnAgentInputSchema,
                getTool: (context) => getToolById('spawn_agent', context),
            }),
            createLazyTool({
                id: 'wait_for',
                description: 'Wait for background task(s) to complete.',
                inputSchema: WaitForInputSchema,
                getTool: (context) => getToolById('wait_for', context),
            }),
            createLazyTool({
                id: 'check_task',
                description: 'Check the status of a background task.',
                inputSchema: CheckTaskInputSchema,
                getTool: (context) => getToolById('check_task', context),
            }),
            createLazyTool({
                id: 'list_tasks',
                description: 'List background tasks and their statuses.',
                inputSchema: ListTasksInputSchema,
                getTool: (context) => getToolById('list_tasks', context),
            }),
        ];
    },
};
