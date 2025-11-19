/**
 * Core types for agent functionality
 */

import type { AgentConfig } from './schemas.js';

/**
 * Provider interface for resolving agent identifiers to configurations.
 *
 * This is a dependency inversion abstraction - core defines what it needs,
 * and outer layers (CLI, server) provide concrete implementations that handle
 * filesystem access, registry lookups, and YAML parsing.
 *
 * Used by spawn_agent tool and other agent delegation mechanisms.
 *
 * Typical implementations handle:
 * - Agent discovery from registries (e.g., ~/.dexto/agents)
 * - Auto-installation of bundled agents
 * - Loading and parsing agent config files from filesystem
 * - Path resolution for custom agent configs
 *
 * @example
 * ```typescript
 * // CLI layer provides the implementation
 * const provider = new DefaultAgentConfigProvider();
 * agent.toolManager.setAgentConfigProvider(provider);
 *
 * // Core uses the abstraction
 * const config = await provider.resolveAgentConfig('code-reviewer');
 * ```
 */
export interface AgentConfigProvider {
    /**
     * Resolve an agent identifier to an AgentConfig.
     *
     * @param agentId - Agent identifier (e.g., 'general-purpose', 'code-reviewer', or file path)
     * @returns Promise resolving to the agent configuration
     * @throws Error if agent cannot be resolved or config cannot be loaded
     */
    resolveAgentConfig(agentId: string): Promise<AgentConfig>;
}
