/**
 * Agent Spawner Tool Provider
 *
 * Custom tool provider that enables agents to spawn sub-agents for task delegation.
 */

import type { CustomToolProvider, InternalTool } from '@dexto/core';
import { AgentSpawnerConfigSchema, type AgentSpawnerConfig } from './schemas.js';
import { RuntimeService } from './runtime-service.js';
import { createSpawnAgentTool } from './spawn-agent-tool.js';

/**
 * Agent Spawner Tools Provider
 *
 * Provides the spawn_agent tool for task delegation to sub-agents.
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

        // Create the runtime service that bridges tools to AgentRuntime
        const service = new RuntimeService(agent, config, logger);

        // Wire up RuntimeService as taskForker for invoke_skill (context: fork support)
        // This enables skills with `context: fork` to execute in isolated subagents
        agent.toolManager.setTaskForker(service);
        logger.debug('RuntimeService wired as taskForker for context:fork skill support');

        return [createSpawnAgentTool(service)];
    },

    metadata: {
        displayName: 'Agent Spawner',
        description: 'Spawn sub-agents for task delegation',
        category: 'agents',
    },
};
