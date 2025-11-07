import { logger, AgentError, DextoAgent } from '@dexto/core';
import { loadAgentConfig } from './config/index.js';
import { getAgentRegistry } from './registry/registry.js';
import { deriveDisplayName } from './registry/types.js';

/**
 * AgentOrchestrator - Main orchestrator class for managing Dexto agents
 *
 * This class serves as the primary entry point for agent lifecycle management,
 * including installation, creation, and coordination of multiple agent instances.
 *
 * ## Current Features
 * - **Agent Discovery**: List available and installed agents
 * - **Agent Installation**: Install agents from registry or custom sources
 * - **Agent Creation**: Factory methods for creating agent instances
 * - **Agent Removal**: Uninstall agents from the system
 *
 * ## Future Orchestration Features (Planned)
 * The following features are planned for future releases to enable advanced
 * multi-agent orchestration and coordination:
 *
 * ### Multi-Agent Instance Management
 * - Manage multiple concurrent agent instances with different configurations
 * - Track agent lifecycle states (created, started, stopped, errored)
 * - Provide APIs for listing and querying active agent instances
 *
 * ### Agent Switching & Routing
 * - Switch between active agents dynamically during runtime
 * - Route requests to appropriate agents based on context or capabilities
 * - Maintain conversation continuity across agent switches
 *
 * ### Cross-Agent Coordination
 * - Enable agents to collaborate on complex tasks requiring specialized skills
 * - Delegate sub-tasks from one agent to another
 * - Aggregate results from multiple agents working in parallel
 *
 * ### Global Event Bus
 * - Centralized event bus for cross-agent communication
 * - Subscribe to events from any managed agent instance
 * - Coordinate state synchronization across agent boundaries
 *
 * ### Resource Management
 * - Shared resource pools (API keys, rate limits, connection pools)
 * - Resource allocation and quota management across agents
 * - Prevent resource conflicts between concurrent agent instances
 *
 * ### Agent Persistence & Sessions
 * - Save and restore agent instances with their full state
 * - Support for long-running agent workflows that span multiple sessions
 * - Checkpoint and resume capabilities for complex agent operations
 *
 * @example
 * ```typescript
 * // List available agents
 * const agents = await AgentOrchestrator.listAgents();
 * console.log(agents.installed, agents.available);
 *
 * // Install agent
 * await AgentOrchestrator.installAgent('productivity');
 *
 * // Create and start agent
 * const agent = await AgentOrchestrator.createAgent('productivity');
 * await agent.start();
 *
 * // Install custom agent
 * await AgentOrchestrator.installCustomAgent('my-agent', '/path/to/config.yml', {
 *   description: 'My custom agent',
 *   author: 'John Doe',
 *   tags: ['custom', 'specialized']
 * });
 * ```
 */
export class AgentOrchestrator {
    /**
     * Lists available and installed agents from the registry.
     * Returns a structured object containing both installed and available agents,
     * along with metadata like descriptions, authors, and tags.
     *
     * @returns Promise resolving to object with installed and available agent lists
     *
     * @example
     * ```typescript
     * const agents = await AgentOrchestrator.listAgents();
     * console.log(agents.installed); // ['default', 'my-custom-agent']
     * console.log(agents.available); // [{ name: 'productivity', description: '...', ... }]
     * console.log(agents.current?.name); // 'default'
     * ```
     */
    public static async listAgents(): Promise<{
        installed: Array<{
            id: string;
            name: string;
            description: string;
            author?: string;
            tags?: string[];
            type: 'builtin' | 'custom';
        }>;
        available: Array<{
            id: string;
            name: string;
            description: string;
            author?: string;
            tags?: string[];
            type: 'builtin' | 'custom';
        }>;
        current?: { id?: string | null; name?: string | null };
    }> {
        const agentRegistry = getAgentRegistry();
        const availableMap = agentRegistry.getAvailableAgents();
        const installedNames = await agentRegistry.getInstalledAgents();

        // Build installed agents list with metadata
        const installed = await Promise.all(
            installedNames.map(async (agentId) => {
                const registryEntry = availableMap[agentId];
                if (registryEntry) {
                    return {
                        id: agentId,
                        name: registryEntry.name,
                        description: registryEntry.description,
                        author: registryEntry.author,
                        tags: registryEntry.tags,
                        type: registryEntry.type,
                    };
                } else {
                    // Handle locally installed agents not in registry
                    try {
                        const config = await loadAgentConfig(agentId);
                        const author = config.agentCard?.provider?.organization;
                        const result: {
                            id: string;
                            name: string;
                            description: string;
                            author?: string;
                            tags?: string[];
                            type: 'builtin' | 'custom';
                        } = {
                            id: agentId,
                            name:
                                typeof config.agentCard?.name === 'string'
                                    ? config.agentCard.name
                                    : deriveDisplayName(agentId),
                            description: config.agentCard?.description || 'Local agent',
                            tags: [],
                            type: 'custom' as const, // Assume custom if not in registry
                        };
                        if (author) {
                            result.author = author;
                        }
                        return result;
                    } catch {
                        const result: {
                            id: string;
                            name: string;
                            description: string;
                            author?: string;
                            tags?: string[];
                            type: 'builtin' | 'custom';
                        } = {
                            id: agentId,
                            name: deriveDisplayName(agentId),
                            description: 'Local agent (config unavailable)',
                            tags: [],
                            type: 'custom' as const, // Assume custom if not in registry
                        };
                        return result;
                    }
                }
            })
        );

        // Build available agents list (excluding already installed)
        const available = Object.entries(availableMap)
            .filter(([agentId]) => !installedNames.includes(agentId))
            .map(([agentId, entry]) => ({
                id: agentId,
                name: entry.name,
                description: entry.description,
                author: entry.author,
                tags: entry.tags,
                type: entry.type,
            }));

        return {
            installed,
            available,
            current: { id: null, name: null }, // TODO: Track current agent name
        };
    }

    /**
     * Installs an agent from the registry.
     * Downloads and sets up the specified agent, making it available for use.
     *
     * @param agentName The name of the agent to install from the registry
     * @returns Promise that resolves when installation is complete
     *
     * @throws {AgentError} When agent is not found in registry or installation fails
     *
     * @example
     * ```typescript
     * await AgentOrchestrator.installAgent('productivity');
     * console.log('Productivity agent installed successfully');
     * ```
     */
    public static async installAgent(agentName: string): Promise<void> {
        const agentRegistry = getAgentRegistry();

        if (!agentRegistry.hasAgent(agentName)) {
            throw AgentError.apiValidationError(`Agent '${agentName}' not found in registry`);
        }

        try {
            await agentRegistry.installAgent(agentName, true);
            logger.info(`Successfully installed agent: ${agentName}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to install agent ${agentName}: ${errorMessage}`);
            throw AgentError.apiValidationError(
                `Installation failed for agent '${agentName}'`,
                error
            );
        }
    }

    /**
     * Installs a custom agent from a local file or directory path.
     * Creates a new custom agent entry in the user registry with provided metadata.
     *
     * @param agentName The name to use for the custom agent (must be unique)
     * @param sourcePath Absolute path to the agent YAML file or directory
     * @param metadata Agent metadata (description, author, tags, main config file)
     * @param injectPreferences Whether to inject global preferences into agent config (default: true)
     * @returns Promise resolving to the path of the installed main config file
     *
     * @throws {AgentError} When name conflicts with existing agent or installation fails
     *
     * @example
     * ```typescript
     * await AgentOrchestrator.installCustomAgent('my-coding-agent', '/path/to/agent.yml', {
     *   description: 'Custom coding assistant',
     *   author: 'John Doe',
     *   tags: ['coding', 'custom']
     * });
     * console.log('Custom agent installed successfully');
     * ```
     */
    public static async installCustomAgent(
        agentName: string,
        sourcePath: string,
        metadata: {
            name?: string;
            description: string;
            author: string;
            tags: string[];
            main?: string;
        },
        injectPreferences: boolean = true
    ): Promise<string> {
        const agentRegistry = getAgentRegistry();

        try {
            const mainConfigPath = await agentRegistry.installCustomAgentFromPath(
                agentName,
                sourcePath,
                metadata,
                injectPreferences
            );
            logger.info(`Successfully installed custom agent: ${agentName}`);
            return mainConfigPath;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to install custom agent ${agentName}: ${errorMessage}`);
            throw AgentError.apiValidationError(
                `Installation failed for custom agent '${agentName}'`,
                error
            );
        }
    }

    /**
     * Uninstalls an agent by removing its directory from disk.
     * For custom agents: also removes from user registry.
     * For builtin agents: only removes from disk (can be reinstalled).
     *
     * @param agentName The name of the agent to uninstall
     * @param force Whether to force uninstall even if agent is protected (default: false)
     * @returns Promise that resolves when uninstallation is complete
     *
     * @throws {AgentError} When agent is not installed or uninstallation fails
     *
     * @example
     * ```typescript
     * await AgentOrchestrator.uninstallAgent('my-custom-agent');
     * console.log('Agent uninstalled successfully');
     * ```
     */
    public static async uninstallAgent(agentName: string, force: boolean = false): Promise<void> {
        const agentRegistry = getAgentRegistry();

        try {
            await agentRegistry.uninstallAgent(agentName, force);
            logger.info(`Successfully uninstalled agent: ${agentName}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to uninstall agent ${agentName}: ${errorMessage}`);
            throw AgentError.apiValidationError(
                `Uninstallation failed for agent '${agentName}'`,
                error
            );
        }
    }

    /**
     * Creates a new agent instance for the specified agent name.
     * This method resolves the agent (installing if needed), loads its configuration,
     * and returns a new DextoAgent instance ready to be started.
     *
     * This is a factory method that doesn't affect any existing agent instances.
     * The caller is responsible for managing the lifecycle of the returned agent.
     *
     * @param agentName The name of the agent to create
     * @returns Promise resolving to a new DextoAgent instance (not started)
     *
     * @throws {AgentError} When agent is not found or creation fails
     *
     * @example
     * ```typescript
     * const newAgent = await AgentOrchestrator.createAgent('productivity');
     * await newAgent.start();
     * ```
     */
    public static async createAgent(agentName: string): Promise<DextoAgent> {
        const agentRegistry = getAgentRegistry();

        try {
            // Resolve agent (will install if needed)
            const agentPath = await agentRegistry.resolveAgent(agentName, true, true);

            // Load agent configuration
            const config = await loadAgentConfig(agentPath);

            // Create new agent (not started)
            logger.info(`Creating agent: ${agentName}`);
            const newAgent = new DextoAgent(config, agentPath);

            logger.info(`Successfully created agent: ${agentName}`);
            return newAgent;
        } catch (error) {
            logger.error(
                `Failed to create agent '${agentName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            throw AgentError.apiValidationError(`Failed to create agent '${agentName}'`, error);
        }
    }
}
