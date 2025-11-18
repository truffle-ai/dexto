/**
 * Default Agent Resolver
 *
 * Provides a default implementation of AgentResolver that uses LocalAgentRegistry
 * to resolve agent identifiers to AgentConfig objects.
 *
 * This resolver:
 * - Uses the local agent registry to find agents
 * - Handles auto-installation if the agent is in the registry but not installed
 * - Loads and parses agent config files from the filesystem
 */

import type { AgentConfig, AgentResolver } from '@dexto/core';
import { getAgentRegistry } from './registry/registry.js';
import { loadAgentConfig } from './config/index.js';

/**
 * Default implementation of AgentResolver
 * Resolves agent identifiers using LocalAgentRegistry and loads configs from filesystem
 */
export class DefaultAgentResolver implements AgentResolver {
    private registry = getAgentRegistry();

    /**
     * Resolve an agent identifier to an AgentConfig
     * @param agentId - Agent identifier (e.g., 'general-purpose', 'code-reviewer')
     * @returns Promise resolving to the agent configuration
     * @throws Error if agent cannot be resolved or config cannot be loaded
     */
    async resolveAgentConfig(agentId: string): Promise<AgentConfig> {
        try {
            // Resolve agent ID to config file path
            // This handles auto-installation if the agent is in the registry but not installed
            const configPath = await this.registry.resolveAgent(agentId, true, true);

            // Load and parse the config file (loadAgentConfig has its own logging)
            const config = await loadAgentConfig(configPath);

            return config;
        } catch (error) {
            throw new Error(
                `Agent '${agentId}' not found in registry. Use 'dexto list-agents' to see available agents.`
            );
        }
    }
}
