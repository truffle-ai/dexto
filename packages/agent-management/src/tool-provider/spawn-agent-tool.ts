/**
 * spawn_agent Tool
 *
 * Spawns a sub-agent to handle a specific task.
 * The sub-agent will execute the task and return the result.
 */

import type { InternalTool, ToolExecutionContext } from '@dexto/core';
import type { TaskRegistry } from '@dexto/orchestration';
import { SpawnAgentInputSchema, type SpawnAgentInput } from './schemas.js';
import type { RuntimeService } from './runtime-service.js';

/**
 * Build dynamic tool description based on available agents from registry
 */
function buildDescription(service: RuntimeService): string {
    const availableAgents = service.getAvailableAgents();

    if (availableAgents.length === 0) {
        return `Spawn a sub-agent to handle a specific task. The sub-agent executes the task and returns the result.

No specialized agents are configured. The sub-agent will inherit your LLM with a minimal config.

## Parameters
- **task**: Short description for UI/logs (e.g., "Search for authentication code")
- **instructions**: Detailed instructions for the sub-agent`;
    }

    // Build available agents section with clear use cases
    const agentsList = availableAgents
        .map((agent) => {
            const tags = agent.tags?.length ? ` [${agent.tags.slice(0, 3).join(', ')}]` : '';
            return `### ${agent.id}
${agent.description}${tags}`;
        })
        .join('\n\n');

    return `Spawn a specialized sub-agent to handle a task. The sub-agent executes independently and returns the result.

## Available Agents

${agentsList}

## Parameters
- **task**: Short description for UI/logs (e.g., "Explore authentication flow")
- **instructions**: Detailed instructions sent to the sub-agent
- **agentId**: Agent ID from the list above (e.g., "${availableAgents[0]?.id ?? 'explore-agent'}")

## Notes
- Sub-agents have their own tools, LLM, and conversation context
- Read-only agents (like explore-agent) have auto-approved tool calls for speed
- If a sub-agent's LLM fails, it automatically falls back to your LLM`;
}

function isBackgroundTasksEnabled(): boolean {
    const value = process.env.DEXTO_BACKGROUND_TASKS_ENABLED;
    if (value === undefined) return false;
    return /^(1|true|yes|on)$/i.test(value.trim());
}

export function createSpawnAgentTool(
    service: RuntimeService,
    taskRegistry?: TaskRegistry,
    onTaskRegistered?: (taskId: string, promise: Promise<unknown>, sessionId?: string) => void
): InternalTool {
    return {
        id: 'spawn_agent',
        description: buildDescription(service),

        inputSchema: SpawnAgentInputSchema,

        execute: async (input: unknown, context?: ToolExecutionContext) => {
            const validatedInput = input as SpawnAgentInput;

            // Build options object - only include optional properties if they have values
            const options: {
                task: string;
                instructions: string;
                agentId?: string;
                toolCallId?: string;
                sessionId?: string;
            } = {
                task: validatedInput.task,
                instructions: validatedInput.instructions,
            };

            if (validatedInput.agentId !== undefined) {
                options.agentId = validatedInput.agentId;
            }
            if (context?.toolCallId !== undefined) {
                options.toolCallId = context.toolCallId;
            }
            if (context?.sessionId !== undefined) {
                options.sessionId = context.sessionId;
            }

            if (isBackgroundTasksEnabled() && context?.toolCallId && taskRegistry) {
                const promise = service.spawnAndExecute(options).then((result) => {
                    if (!result.success) {
                        throw new Error(result.error ?? 'Unknown error');
                    }
                    return result.response ?? 'Task completed successfully.';
                });

                try {
                    taskRegistry.registerAgentTask(
                        context.toolCallId,
                        `Spawn agent: ${validatedInput.task}`,
                        promise
                    );
                } catch (error) {
                    promise.catch(() => undefined);
                    throw error;
                }
                onTaskRegistered?.(context.toolCallId, promise, context.sessionId);

                return {
                    taskId: context.toolCallId,
                    status: 'running',
                };
            }

            const result = await service.spawnAndExecute(options);

            // Return clean output: just response on success, error message on failure
            if (result.success) {
                return result.response ?? 'Task completed successfully.';
            } else {
                return `Error: ${result.error ?? 'Unknown error'}`;
            }
        },
    };
}
