/**
 * Agent Spawner Tool Provider
 *
 * Custom tool provider that enables agents to spawn and manage sub-agents
 * for task delegation.
 */

import type { CustomToolProvider, InternalTool } from '@dexto/core';
import { AgentSpawnerConfigSchema, type AgentSpawnerConfig } from './schemas.js';
import { RuntimeService } from './runtime-service.js';
import { createSpawnAgentTool } from './spawn-agent-tool.js';
import { createDelegateTaskTool } from './delegate-task-tool.js';
import { createGetStatusTool } from './get-status-tool.js';
import { createListAgentsTool } from './list-agents-tool.js';
import { createStopAgentTool } from './stop-agent-tool.js';

/**
 * Agent Spawner Tools Provider
 *
 * Provides tools for spawning and managing sub-agents:
 * - spawn_agent: Spawn a sub-agent to handle a task
 * - delegate_task: Send a task to an existing persistent agent
 * - get_agent_status: Check the status of a sub-agent
 * - list_agents: List all active sub-agents
 * - stop_agent: Stop and cleanup a sub-agent
 *
 * Configuration:
 * ```yaml
 * tools:
 *   customTools:
 *     - type: agent-spawner
 *       maxConcurrentAgents: 5
 *       defaultTimeout: 300000
 *       maxNestingDepth: 1
 *       allowSpawning: true
 * ```
 */
export const agentSpawnerToolsProvider: CustomToolProvider<'agent-spawner', AgentSpawnerConfig> = {
    type: 'agent-spawner',

    configSchema: AgentSpawnerConfigSchema,

    create: (config, context): InternalTool[] => {
        const { logger, agent } = context;

        // Create the runtime service that bridges tools to AgentRuntime
        const service = new RuntimeService(agent, config, logger);

        // Return all tools
        return [
            createSpawnAgentTool(service),
            createDelegateTaskTool(service),
            createGetStatusTool(service),
            createListAgentsTool(service),
            createStopAgentTool(service),
        ];
    },

    metadata: {
        displayName: 'Agent Spawner Tools',
        description: 'Tools for spawning and managing sub-agents for task delegation',
        category: 'agents',
    },
};
