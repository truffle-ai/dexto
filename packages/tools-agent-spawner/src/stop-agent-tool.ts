/**
 * stop_agent Tool
 *
 * Stops and cleans up a specific sub-agent.
 */

import type { InternalTool } from '@dexto/core';
import { StopAgentInputSchema, type StopAgentInput } from './schemas.js';
import type { RuntimeService } from './runtime-service.js';

export function createStopAgentTool(service: RuntimeService): InternalTool {
    return {
        id: 'stop_agent',
        description: `Stop and clean up a specific sub-agent.

Use this to terminate a persistent agent (spawned with ephemeral=false) when you no longer need it.

This will:
- Cancel any pending approval requests
- Stop the agent's execution
- Clean up resources

Ephemeral agents are automatically cleaned up after task completion, so you typically don't need to call this for them.`,

        inputSchema: StopAgentInputSchema,

        execute: async (input: unknown) => {
            const validatedInput = input as StopAgentInput;

            const result = await service.stopAgent(validatedInput.agentId);

            return result;
        },
    };
}
