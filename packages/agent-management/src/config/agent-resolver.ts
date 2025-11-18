/**
 * Default Agent Config Provider
 *
 * Provides a default implementation of AgentConfigProvider that uses LocalAgentRegistry
 * to resolve agent identifiers to AgentConfig objects.
 *
 * This is the CLI/server layer implementation that handles:
 * - Local agent registry lookups
 * - Auto-installation of agents from the registry
 * - Filesystem access to load agent config YAML files
 * - Path resolution for custom agent configs
 *
 * This implementation is injected into core's DextoAgent via dependency inversion,
 * keeping core free of filesystem dependencies.
 */

import type { AgentConfig, AgentConfigProvider } from '@dexto/core';
import { getAgentRegistry } from '../registry/registry.js';
import { loadAgentConfig } from '../config/index.js';

/**
 * Default implementation of AgentConfigProvider.
 * Resolves agent identifiers using LocalAgentRegistry and loads configs from filesystem.
 *
 * @example
 * ```typescript
 * const provider = new DefaultAgentConfigProvider();
 * agent.toolManager.setAgentConfigProvider(provider);
 * ```
 */
export class DefaultAgentConfigProvider implements AgentConfigProvider {
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
