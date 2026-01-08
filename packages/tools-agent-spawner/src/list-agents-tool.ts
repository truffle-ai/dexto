/**
 * list_agents Tool
 *
 * Lists all active sub-agents spawned by this parent.
 */

import type { InternalTool } from '@dexto/core';
import { ListAgentsInputSchema } from './schemas.js';
import type { RuntimeService } from './runtime-service.js';

export function createListAgentsTool(service: RuntimeService): InternalTool {
    return {
        id: 'list_agents',
        description: `List all active sub-agents you have spawned.

Returns a list of agents with their:
- Agent ID
- Current status
- Whether they are ephemeral
- When they were created

This is useful for managing persistent agents and checking what's currently running.`,

        inputSchema: ListAgentsInputSchema,

        execute: async () => {
            const result = service.listAgents();

            return result;
        },
    };
}
