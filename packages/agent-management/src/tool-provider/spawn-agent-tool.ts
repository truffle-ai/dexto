/**
 * spawn_agent Tool
 *
 * Spawns a sub-agent to handle a specific task.
 * The sub-agent will execute the task and return the result.
 */

import type { InternalTool } from '@dexto/core';
import { SpawnAgentInputSchema, type SpawnAgentInput } from './schemas.js';
import type { RuntimeService } from './runtime-service.js';

/**
 * Build dynamic tool description based on configured agents
 */
function buildDescription(service: RuntimeService): string {
    const baseDescription = `Spawn a sub-agent to handle a specific task. The sub-agent will execute the task and return the result.

Use this tool when you need to:
- Delegate a complex or time-consuming task to another agent
- Run a task that requires different capabilities or focus
- Parallelize work by spawning multiple agents (call multiple times)

The sub-agent has its own conversation context and will complete the task independently.
Tool approval requests from the sub-agent will be routed to you for approval.`;

    const configuredAgents = service.getConfiguredAgents();

    if (configuredAgents.length === 0) {
        return `${baseDescription}

When spawning, you can provide a custom systemPrompt to guide the sub-agent's behavior.
The sub-agent inherits the parent's LLM configuration.`;
    }

    // Build available agents section dynamically
    const agentsList = configuredAgents
        .map(({ name, description }) => {
            if (description) {
                return `- "${name}" - ${description}`;
            }
            return `- "${name}"`;
        })
        .join('\n');

    return `${baseDescription}

## Available Agents
Use agentRef to spawn a pre-configured specialized agent:
${agentsList}

When agentRef is provided, the sub-agent uses its own LLM, tools, and system prompt.
When not provided, the sub-agent inherits the parent's LLM with a minimal config.`;
}

export function createSpawnAgentTool(service: RuntimeService): InternalTool {
    return {
        id: 'spawn_agent',
        description: buildDescription(service),

        inputSchema: SpawnAgentInputSchema,

        execute: async (input: unknown) => {
            const validatedInput = input as SpawnAgentInput;

            // Build options object - only include optional properties if they have values
            const options: {
                task: string;
                agentRef?: string;
                systemPrompt?: string;
                timeout?: number;
            } = {
                task: validatedInput.task,
            };
            if (validatedInput.agentRef !== undefined) {
                options.agentRef = validatedInput.agentRef;
            }
            if (validatedInput.systemPrompt !== undefined) {
                options.systemPrompt = validatedInput.systemPrompt;
            }
            if (validatedInput.timeout !== undefined) {
                options.timeout = validatedInput.timeout;
            }

            const result = await service.spawnAndExecute(options);

            return result;
        },
    };
}
