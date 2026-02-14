import type { ToolFactory } from '@dexto/agent-config';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { ToolBackgroundEvent } from '@dexto/core';
import { ToolError } from '@dexto/core';
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
    spawnAgent: Tool;
    waitFor: Tool;
    checkTask: Tool;
    listTasks: Tool;
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
                logger.debug(
                    'AgentSpawnerRuntime attached as taskForker for context:fork skill support'
                );
            }
        };

        const ensureToolsInitialized = (
            context: ToolExecutionContext
        ): InitializedAgentSpawnerTools => {
            const { agent, logger, toolServices } = requireAgentContext(context);

            if (state && state.agent === agent && !state.abortController.signal.aborted) {
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

            const signalBus = new SignalBus();
            const taskRegistry = new TaskRegistry(signalBus);
            const conditionEngine = new ConditionEngine(taskRegistry, signalBus, logger);

            // Create the runtime bridge that spawns/executes sub-agents.
            const spawnerRuntime = new AgentSpawnerRuntime(agent, config, logger);
            attachTaskForker({ toolServices, taskForker: spawnerRuntime, logger });

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

            const abortController = new AbortController();
            agent.on('tool:background', handleBackground, {
                signal: abortController.signal,
            });
            agent.on(
                'agent:stopped',
                () => {
                    spawnerRuntime.cleanup().catch(() => undefined);
                    abortController.abort();
                },
                { signal: abortController.signal }
            );

            const spawnAgentTool = createSpawnAgentTool(spawnerRuntime);
            const waitForTool = createWaitForTool(conditionEngine);
            const checkTaskTool = createCheckTaskTool(taskRegistry);
            const listTasksTool = createListTasksTool(taskRegistry);

            const tools: InitializedAgentSpawnerTools = {
                spawnAgent: spawnAgentTool,
                waitFor: waitForTool,
                checkTask: checkTaskTool,
                listTasks: listTasksTool,
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
                inputSchema: SpawnAgentInputSchema,
                execute: (input, context) =>
                    ensureToolsInitialized(context).spawnAgent.execute(input, context),
                generatePreview: async (input, context) => {
                    const tool = ensureToolsInitialized(context).spawnAgent;
                    if (!tool.generatePreview) {
                        return null;
                    }
                    return await tool.generatePreview(input, context);
                },
            },
            {
                id: 'wait_for',
                description: 'Wait for background task(s) to complete.',
                inputSchema: WaitForInputSchema,
                execute: (input, context) =>
                    ensureToolsInitialized(context).waitFor.execute(input, context),
                generatePreview: async (input, context) => {
                    const tool = ensureToolsInitialized(context).waitFor;
                    if (!tool.generatePreview) {
                        return null;
                    }
                    return await tool.generatePreview(input, context);
                },
            },
            {
                id: 'check_task',
                description: 'Check the status of a background task.',
                inputSchema: CheckTaskInputSchema,
                execute: (input, context) =>
                    ensureToolsInitialized(context).checkTask.execute(input, context),
                generatePreview: async (input, context) => {
                    const tool = ensureToolsInitialized(context).checkTask;
                    if (!tool.generatePreview) {
                        return null;
                    }
                    return await tool.generatePreview(input, context);
                },
            },
            {
                id: 'list_tasks',
                description: 'List background tasks and their statuses.',
                inputSchema: ListTasksInputSchema,
                execute: (input, context) =>
                    ensureToolsInitialized(context).listTasks.execute(input, context),
                generatePreview: async (input, context) => {
                    const tool = ensureToolsInitialized(context).listTasks;
                    if (!tool.generatePreview) {
                        return null;
                    }
                    return await tool.generatePreview(input, context);
                },
            },
        ];
    },
};
