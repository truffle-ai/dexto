/**
 * spawn_agent Tool
 *
 * Spawns a sub-agent to handle a specific task.
 * The sub-agent will execute the task and return the result.
 */

import type { InternalTool } from '@dexto/core';
import { SpawnAgentInputSchema, type SpawnAgentInput } from './schemas.js';
import type { RuntimeService } from './runtime-service.js';

export function createSpawnAgentTool(service: RuntimeService): InternalTool {
    return {
        id: 'spawn_agent',
        description: `Spawn a sub-agent to handle a specific task. The sub-agent will execute the task and return the result.

Use this tool when you need to:
- Delegate a complex or time-consuming task to another agent
- Run a task that requires different capabilities or focus
- Parallelize work by spawning multiple agents (call multiple times)

The sub-agent has its own conversation context and will complete the task independently.
Tool approval requests from the sub-agent will be routed to you for approval.

By default, sub-agents are ephemeral (destroyed after task completion). Set ephemeral=false to keep them for multiple tasks.`,

        inputSchema: SpawnAgentInputSchema,

        execute: async (input: unknown) => {
            const validatedInput = input as SpawnAgentInput;

            // Build options object - only include optional properties if they have values
            const options: {
                task: string;
                systemPrompt?: string;
                ephemeral?: boolean;
                timeout?: number;
            } = {
                task: validatedInput.task,
            };
            if (validatedInput.systemPrompt !== undefined) {
                options.systemPrompt = validatedInput.systemPrompt;
            }
            if (validatedInput.ephemeral !== undefined) {
                options.ephemeral = validatedInput.ephemeral;
            }
            if (validatedInput.timeout !== undefined) {
                options.timeout = validatedInput.timeout;
            }

            const result = await service.spawnAndExecute(options);

            return result;
        },
    };
}
