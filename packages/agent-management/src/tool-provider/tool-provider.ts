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
        const { logger, agent } = context;

        const signalBus = new SignalBus();
        const taskRegistry = new TaskRegistry(signalBus);
        const conditionEngine = new ConditionEngine(taskRegistry, signalBus);

        const toolContext: OrchestrationToolContext = {
            taskRegistry,
            conditionEngine,
            signalBus,
        };

        // Create the runtime service that bridges tools to AgentRuntime
        const service = new RuntimeService(agent, config, logger);

        // Wire up RuntimeService as taskForker for invoke_skill (context: fork support)
        // This enables skills with `context: fork` to execute in isolated subagents
        agent.toolManager.setTaskForker(service);
        logger.debug('RuntimeService wired as taskForker for context:fork skill support');

        const handleBackground = (event: ToolBackgroundEvent) => {
            const taskId = event.toolCallId;
            if (taskRegistry.has(taskId)) {
                return;
            }

            taskRegistry.register(
                {
                    type: 'generic',
                    taskId,
                    description: event.description ?? `Tool ${event.toolName}`,
                    promise: event.promise,
                },
                {
                    ...(event.timeoutMs !== undefined && { timeout: event.timeoutMs }),
                    ...(event.notifyOnComplete !== undefined && { notify: event.notifyOnComplete }),
                }
            );
        };

        agent.agentEventBus.on('tool:background', handleBackground);

        return [
            createSpawnAgentTool(service, taskRegistry),
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
