import { promises as fs } from 'fs';
import path from 'path';
import { logger, DextoAgent, AgentError } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from './config/index.js';
import { z } from 'zod';

/**
 * Agent metadata - describes an agent in the registry
 */
export interface AgentMetadata {
    id: string;
    name: string;
    description: string;
    author?: string | undefined;
    tags?: string[] | undefined;
}

/**
 * Registry file schema
 */
const RegistrySchema = z.object({
    agents: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            configPath: z.string(),
            author: z.string().optional(),
            tags: z.array(z.string()).optional(),
        })
    ),
});

type Registry = z.output<typeof RegistrySchema>;

/**
 * AgentManager - Simple registry-based agent lifecycle management
 *
 * Provides a clean API for loading agent configurations from a registry file
 * and creating agent instances. The registry is a JSON file that lists available
 * agents and their config file paths.
 *
 * @example
 * ```typescript
 * // Point to your registry
 * const manager = new AgentManager('./agents/registry.json');
 *
 * // List available agents
 * const agents = manager.listAgents();
 * console.log(agents); // [{ id: 'coding-agent', name: '...', ... }]
 *
 * // Create an agent instance
 * const agent = await manager.createAgent('coding-agent');
 * await agent.start();
 * ```
 */
export class AgentManager {
    private registry: Registry | null = null;
    private registryPath: string;
    private basePath: string;

    /**
     * Create a new AgentManager
     *
     * @param registryPath Absolute or relative path to registry.json file
     *
     * @example
     * ```typescript
     * // Project-local registry
     * const manager = new AgentManager('./agents/registry.json');
     *
     * // Absolute path
     * const manager = new AgentManager('/path/to/registry.json');
     * ```
     */
    constructor(registryPath: string) {
        this.registryPath = path.resolve(registryPath);
        this.basePath = path.dirname(this.registryPath);
    }

    /**
     * Load registry from file (lazy loaded, cached)
     */
    private async loadRegistry(): Promise<Registry> {
        if (this.registry) {
            return this.registry;
        }

        try {
            const content = await fs.readFile(this.registryPath, 'utf-8');
            const parsed = JSON.parse(content);
            this.registry = RegistrySchema.parse(parsed);
            logger.debug(
                `Loaded registry from ${this.registryPath}: ${this.registry.agents.length} agents`
            );
            return this.registry;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw AgentError.apiValidationError(
                    `Registry file not found: ${this.registryPath}`
                );
            }
            throw AgentError.apiValidationError(
                `Failed to load registry: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * List all agents in the registry
     *
     * @returns Array of agent metadata
     *
     * @example
     * ```typescript
     * const manager = new AgentManager('./registry.json');
     * const agents = manager.listAgents();
     * console.log(agents);
     * // [
     * //   { id: 'coding-agent', name: 'Coding Assistant', description: '...', tags: ['coding'] },
     * //   { id: 'support-agent', name: 'Support Assistant', description: '...', tags: ['support'] }
     * // ]
     * ```
     */
    listAgents(): AgentMetadata[] {
        if (!this.registry) {
            throw AgentError.apiValidationError(
                'Registry not loaded. Call loadRegistry() first or use async methods.'
            );
        }

        return this.registry.agents.map((entry) => ({
            id: entry.id,
            name: entry.name,
            description: entry.description,
            author: entry.author,
            tags: entry.tags,
        }));
    }

    /**
     * Create a DextoAgent instance from registry
     *
     * @param id Agent ID from registry
     * @returns Promise resolving to DextoAgent instance (not started)
     *
     * @throws {AgentError} If agent not found or config loading fails
     *
     * @example
     * ```typescript
     * const manager = new AgentManager('./registry.json');
     * const agent = await manager.createAgent('coding-agent');
     * await agent.start();
     *
     * // Use the agent
     * const session = await agent.createSession();
     * const response = await agent.generate('Write a function', { sessionId: session.id });
     * ```
     */
    async createAgent(id: string): Promise<DextoAgent> {
        const registry = await this.loadRegistry();

        // Find agent in registry
        const entry = registry.agents.find((a) => a.id === id);
        if (!entry) {
            const available = registry.agents.map((a) => a.id);
            throw AgentError.apiValidationError(
                `Agent '${id}' not found in registry. Available agents: ${available.join(', ')}`
            );
        }

        // Resolve config path relative to registry location
        const configPath = path.resolve(this.basePath, entry.configPath);

        try {
            // Load and enrich agent config
            const config = await loadAgentConfig(configPath);
            const enrichedConfig = enrichAgentConfig(config, configPath);

            // Create agent instance
            logger.info(`Creating agent: ${id} from ${configPath}`);
            return new DextoAgent(enrichedConfig, configPath);
        } catch (error) {
            throw AgentError.apiValidationError(
                `Failed to create agent '${id}': ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Check if an agent exists in the registry
     *
     * @param id Agent ID to check
     * @returns True if agent exists
     *
     * @example
     * ```typescript
     * const manager = new AgentManager('./registry.json');
     * await manager.loadRegistry();
     *
     * if (manager.hasAgent('coding-agent')) {
     *   const agent = await manager.createAgent('coding-agent');
     * }
     * ```
     */
    hasAgent(id: string): boolean {
        if (!this.registry) {
            throw AgentError.apiValidationError(
                'Registry not loaded. Call loadRegistry() first or use async methods.'
            );
        }

        return this.registry.agents.some((a) => a.id === id);
    }
}
