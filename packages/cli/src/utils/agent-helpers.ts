// packages/cli/src/utils/agent-helpers.ts

import path from 'path';
import {
    AgentManager,
    getDextoGlobalPath,
    installBundledAgent as installBundledAgentCore,
    installCustomAgent as installCustomAgentCore,
    uninstallAgent as uninstallAgentCore,
    listInstalledAgents as listInstalledAgentsCore,
    type InstallOptions,
    type AgentMetadata,
} from '@dexto/agent-management';

/**
 * Singleton AgentManager instance for CLI commands
 * Points to ~/.dexto/agents/registry.json
 */
let cliAgentManager: AgentManager | null = null;

/**
 * Get or create the CLI AgentManager instance
 *
 * This manager operates on the global agents directory (~/.dexto/agents)
 * and uses the user registry file (~/.dexto/agents/registry.json).
 *
 * @returns AgentManager instance for CLI operations
 *
 * @example
 * ```typescript
 * const manager = getCLIAgentManager();
 * await manager.loadRegistry();
 * const agents = manager.listAgents();
 * ```
 */
export function getCLIAgentManager(): AgentManager {
    if (cliAgentManager === null) {
        const registryPath = path.join(getDextoGlobalPath('agents'), 'registry.json');
        cliAgentManager = new AgentManager(registryPath);
    }
    return cliAgentManager;
}

/**
 * Reset the CLI AgentManager singleton (primarily for testing)
 *
 * @example
 * ```typescript
 * // In tests
 * resetCLIAgentManager();
 * const manager = getCLIAgentManager(); // Creates fresh instance
 * ```
 */
export function resetCLIAgentManager(): void {
    cliAgentManager = null;
}

/**
 * Install bundled agent from registry to ~/.dexto/agents
 *
 * @param agentId ID of the agent to install from bundled registry
 * @param options Installation options (agentsDir defaults to ~/.dexto/agents)
 * @returns Path to the installed agent's main config file
 *
 * @throws {Error} If agent not found in bundled registry or installation fails
 *
 * @example
 * ```typescript
 * await installBundledAgent('coding-agent');
 * console.log('Agent installed to ~/.dexto/agents/coding-agent');
 * ```
 */
export async function installBundledAgent(
    agentId: string,
    options?: InstallOptions
): Promise<string> {
    return installBundledAgentCore(agentId, options);
}

/**
 * Install custom agent from local path to ~/.dexto/agents
 *
 * @param agentId Unique ID for the custom agent
 * @param sourcePath Absolute path to agent YAML file or directory
 * @param metadata Agent metadata (name, description, author, tags)
 * @param options Installation options (agentsDir defaults to ~/.dexto/agents)
 * @returns Path to the installed agent's main config file
 *
 * @throws {Error} If agent ID already exists or installation fails
 *
 * @example
 * ```typescript
 * await installCustomAgent('my-agent', '/path/to/agent.yml', {
 *   name: 'My Agent',
 *   description: 'Custom agent for my use case',
 *   author: 'John Doe',
 *   tags: ['custom']
 * });
 * ```
 */
export async function installCustomAgent(
    agentId: string,
    sourcePath: string,
    metadata: Pick<AgentMetadata, 'name' | 'description' | 'author' | 'tags'>,
    options?: InstallOptions
): Promise<string> {
    return installCustomAgentCore(agentId, sourcePath, metadata, options);
}

/**
 * Uninstall agent by removing it from disk and user registry
 *
 * @param agentId ID of the agent to uninstall
 * @param options Installation options (agentsDir defaults to ~/.dexto/agents)
 *
 * @throws {Error} If agent not found or uninstallation fails
 *
 * @example
 * ```typescript
 * await uninstallAgent('my-custom-agent');
 * console.log('Agent uninstalled');
 * ```
 */
export async function uninstallAgent(agentId: string, options?: InstallOptions): Promise<void> {
    return uninstallAgentCore(agentId, options);
}

/**
 * List installed agents from ~/.dexto/agents
 *
 * @param options Installation options (agentsDir defaults to ~/.dexto/agents)
 * @returns Array of installed agent IDs
 *
 * @example
 * ```typescript
 * const installed = await listInstalledAgents();
 * console.log(installed); // ['coding-agent', 'my-custom-agent']
 * ```
 */
export async function listInstalledAgents(options?: InstallOptions): Promise<string[]> {
    return listInstalledAgentsCore(options);
}
