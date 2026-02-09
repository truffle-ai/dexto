/**
 * Agent Spawner Tool Provider
 *
 * Custom tool provider that enables agents to spawn sub-agents for task delegation.
 */

import type { CustomToolProvider, InternalTool } from '@dexto/core';
import {
    ConditionEngine,
    SignalBus,
    TaskRegistry,
    createCheckTaskTool,
    createListTasksTool,
    createWaitForTool,
    type OrchestrationTool,
    type OrchestrationToolContext,
} from '@dexto/orchestration';
import type { ToolBackgroundEvent } from '@dexto/core';
import { AgentSpawnerConfigSchema, type AgentSpawnerConfig } from './schemas.js';
import { RuntimeService } from './runtime-service.js';
import { createSpawnAgentTool } from './spawn-agent-tool.js';

/**
 * Helper to bind OrchestrationTool to InternalTool by injecting context
 */
function bindOrchestrationTool(
    tool: OrchestrationTool,
    context: OrchestrationToolContext
): InternalTool {
    return {
        id: tool.id,
        description: tool.description,
        inputSchema: tool.inputSchema as InternalTool['inputSchema'],
        execute: (input: unknown) => tool.execute(input, context),
    };
}

/**
 * Agent Spawner Tools Provider
 *
 * Provides tools for spawning and managing sub-agents:
 * - spawn_agent: Spawn a sub-agent to handle a task
 *
 * Orchestration tools (for background task management):
 * - wait_for: Wait for background task(s) to complete
 * - check_task: Check status of a background task
 * - list_tasks: List all tracked background tasks
 *
 * Configuration:
 * ```yaml
 * tools:
 *   customTools:
 *     - type: agent-spawner
 *       maxConcurrentAgents: 5
 *       defaultTimeout: 300000
 *       allowSpawning: true
 * ```
 */
export const agentSpawnerToolsProvider: CustomToolProvider<'agent-spawner', AgentSpawnerConfig> = {
    type: 'agent-spawner',

    configSchema: AgentSpawnerConfigSchema,

    create: (config, context): InternalTool[] => {
        const { logger, agent, services } = context;

        const signalBus = new SignalBus();
        const taskRegistry = new TaskRegistry(signalBus);
        const conditionEngine = new ConditionEngine(taskRegistry, signalBus, logger);

        const toolContext: OrchestrationToolContext = {
            taskRegistry,
            conditionEngine,
            signalBus,
        };

        // Create the runtime service that bridges tools to AgentRuntime
        const service = new RuntimeService(agent, config, logger);

        // Wire up RuntimeService as taskForker for invoke_skill (context: fork support)
        // This enables skills with `context: fork` to execute in isolated subagents
        if (services) {
            // TODO: temporary glue code to be removed/verified
            services.taskForker = service;
            logger.debug('RuntimeService wired as taskForker for context:fork skill support');
        } else {
            logger.warn(
                'Tool provider services not available; forked skills (context: fork) will be disabled'
            );
        }

        const taskSessions = new Map<string, string>();

        const emitTasksUpdate = (sessionId?: string) => {
            const tasks = taskRegistry.list({
                status: ['running', 'completed', 'failed', 'cancelled'],
            });
            const scopedTasks = sessionId
                ? tasks.filter((task) => taskSessions.get(task.taskId) === sessionId)
                : tasks;
            const runningCount = scopedTasks.filter((task) => task.status === 'running').length;

            agent.agentEventBus.emit('service:event', {
                service: 'orchestration',
                event: 'tasks-updated',
                sessionId: sessionId ?? '',
                data: {
                    runningCount,
                    tasks: scopedTasks.map((task) => ({
                        taskId: task.taskId,
                        status: task.status,
                        ...(task.description !== undefined && { description: task.description }),
                    })),
                },
            });
        };

        const triggerBackgroundCompletion = (taskId: string, sessionId?: string) => {
            if (!sessionId) {
                return;
            }

            agent.agentEventBus.emit('tool:background-completed', {
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
                        agent.agentEventBus.emit('run:invoke', {
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

        const backgroundAbortController = new AbortController();
        agent.agentEventBus.on('tool:background', handleBackground, {
            signal: backgroundAbortController.signal,
        });
        agent.agentEventBus.on('agent:stopped', () => {
            backgroundAbortController.abort();
        });

        const tool = createSpawnAgentTool(service, taskRegistry, (taskId, promise, sessionId) => {
            if (sessionId) {
                taskSessions.set(taskId, sessionId);
            }

            emitTasksUpdate(sessionId);
            promise.finally(() => {
                taskSessions.delete(taskId);
                emitTasksUpdate(sessionId);
                triggerBackgroundCompletion(taskId, sessionId);
            });
        });

        return [
            tool,
            bindOrchestrationTool(createWaitForTool(), toolContext),
            bindOrchestrationTool(createCheckTaskTool(), toolContext),
            bindOrchestrationTool(createListTasksTool(), toolContext),
        ];
    },

    metadata: {
        displayName: 'Agent Spawner',
        description: 'Spawn sub-agents for task delegation',
        category: 'agents',
    },
};
