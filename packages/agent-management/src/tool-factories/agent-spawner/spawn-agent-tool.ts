/**
 * spawn_agent Tool
 *
 * Spawns a sub-agent to handle a specific task.
 * The sub-agent will execute the task and return the result.
 */

import { createLocalToolCallHeader, truncateForHeader } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { SpawnAgentInputSchema } from './schemas.js';
import type { AgentSpawnerRuntime } from './runtime.js';

/**
 * Build dynamic tool description based on available agents from registry
 */
function buildDescription(service: AgentSpawnerRuntime): string {
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

export function createSpawnAgentTool(
    service: AgentSpawnerRuntime
): Tool<typeof SpawnAgentInputSchema> {
    return {
        id: 'spawn_agent',
        aliases: ['task'],
        description: buildDescription(service),

        presentation: {
            describeHeader: (input) => {
                const agentLabel = input.agentId ? input.agentId.replace(/-agent$/, '') : null;
                const title = agentLabel
                    ? agentLabel.charAt(0).toUpperCase() + agentLabel.slice(1)
                    : 'Agent';

                const task = typeof input.task === 'string' ? input.task : '';
                const argsText = task ? truncateForHeader(task, 120) : undefined;

                return createLocalToolCallHeader({ title, ...(argsText ? { argsText } : {}) });
            },
        },

        inputSchema: SpawnAgentInputSchema,

        execute: async (input, context: ToolExecutionContext) => {
            // Build options object - only include optional properties if they have values
            const options: {
                task: string;
                instructions: string;
                agentId?: string;
                toolCallId?: string;
                sessionId?: string;
            } = {
                task: input.task,
                instructions: input.instructions,
            };

            if (input.agentId !== undefined) {
                options.agentId = input.agentId;
            }
            if (context.toolCallId !== undefined) {
                options.toolCallId = context.toolCallId;
            }
            if (context.sessionId !== undefined) {
                options.sessionId = context.sessionId;
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
