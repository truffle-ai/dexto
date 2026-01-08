/**
 * get_agent_status Tool
 *
 * Gets the status of a specific sub-agent.
 */

import type { InternalTool } from '@dexto/core';
import { GetAgentStatusInputSchema, type GetAgentStatusInput } from './schemas.js';
import type { RuntimeService } from './runtime-service.js';

export function createGetStatusTool(service: RuntimeService): InternalTool {
    return {
        id: 'get_agent_status',
        description: `Get the status of a specific sub-agent.

Returns information about the agent including:
- Current status (starting, idle, running, stopping, stopped, error)
- Whether it's ephemeral
- When it was created

Use this to check on agents you've spawned with ephemeral=false.`,

        inputSchema: GetAgentStatusInputSchema,

        execute: async (input: unknown) => {
            const validatedInput = input as GetAgentStatusInput;

            const result = service.getStatus(validatedInput.agentId);

            return result;
        },
    };
}
