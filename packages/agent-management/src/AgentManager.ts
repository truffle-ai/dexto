/**
 * AgentManager - Registry-based agent lifecycle management
 *
 * USE THIS WHEN: You have a registry.json file with multiple predefined agents
 * and need discovery/selection capabilities (listAgents, hasAgent, createAgent by ID).
 *
 * Examples:
 * - CLI tools with multiple agent options
 * - Projects with several predefined agents users can choose from
 *
 * FOR INLINE/DYNAMIC CONFIGS: Use `AgentFactory.createAgent(config)` instead.
 * This is better when configs come from a database, API, or are constructed
 * programmatically without a registry file.
 *
 * @see AgentFactory.createAgent() for inline config creation
 * @see https://docs.dexto.ai/api/sdk/agent-manager for full documentation
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger, DextoValidationError, zodToIssues } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';
import { loadAgentConfig } from './config/index.js';
import { RegistryError } from './registry/errors.js';
import { z, ZodError } from 'zod';
import { createDextoAgentFromConfig } from './agent-creation.js';

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
const RegistrySchema = z
    .object({
        agents: z.array(
            z
                .object({
                    id: z.string(),
                    name: z.string(),
                    description: z.string(),
                    configPath: z.string(),
                    author: z.string().optional(),
                    tags: z.array(z.string()).optional(),
                })
                .strict()
        ),
    })
    .strict();

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
 * // Load an agent instance
 * const agent = await manager.loadAgent('coding-agent');
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
     *
     * Call this before using sync methods like `listAgents()` or `hasAgent()`.
     * Alternatively, calling `loadAgent()` will automatically load the registry.
     *
     * @returns The loaded registry
     *
     * @example
     * ```typescript
     * const manager = new AgentManager('./registry.json');
     * await manager.loadRegistry();
     *
     * // Now sync methods work
     * const agents = manager.listAgents();
     * ```
     */
    async loadRegistry(): Promise<Registry> {
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
                throw RegistryError.registryNotFound(this.registryPath, 'File does not exist');
            }
            if (error instanceof ZodError) {
                throw RegistryError.registryParseError(
                    this.registryPath,
                    `Invalid registry schema: ${error.errors.map((e) => e.message).join(', ')}`
                );
            }
            throw RegistryError.registryParseError(
                this.registryPath,
                error instanceof Error ? error.message : String(error)
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
            throw RegistryError.registryNotFound(
                this.registryPath,
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
     * Load a DextoAgent instance from registry
     *
     * @param id Agent ID from registry
     * @returns Promise resolving to DextoAgent instance (not started)
     *
     * @throws {DextoRuntimeError} If agent not found or config loading fails
     * @throws {DextoValidationError} If agent config validation fails
     *
     * @example
     * ```typescript
     * const manager = new AgentManager('./registry.json');
     * const agent = await manager.loadAgent('coding-agent');
     * await agent.start();
     *
     * // Use the agent
     * const session = await agent.createSession();
     * const response = await agent.generate('Write a function', session.id);
     * ```
     */
    async loadAgent(id: string): Promise<DextoAgent> {
        const registry = await this.loadRegistry();

        // Find agent in registry
        const entry = registry.agents.find((a) => a.id === id);
        if (!entry) {
            const available = registry.agents.map((a) => a.id);
            throw RegistryError.agentNotFound(id, available);
        }

        // Resolve config path relative to registry location
        const configPath = path.resolve(this.basePath, entry.configPath);

        try {
            const config = await loadAgentConfig(configPath);

            // Load agent instance
            logger.debug(`Loading agent: ${id} from ${configPath}`);
            return await createDextoAgentFromConfig({ config, configPath });
        } catch (error) {
            // Convert ZodError to DextoValidationError for better error messages
            if (error instanceof ZodError) {
                const issues = zodToIssues(error, 'error');
                throw new DextoValidationError(issues);
            }
            // Re-throw DextoRuntimeError and DextoValidationError as-is
            if (error instanceof Error && error.name.startsWith('Dexto')) {
                throw error;
            }
            // Wrap other errors
            throw RegistryError.installationFailed(
                id,
                error instanceof Error ? error.message : String(error)
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
     *   const agent = await manager.loadAgent('coding-agent');
     * }
     * ```
     */
    hasAgent(id: string): boolean {
        if (!this.registry) {
            throw RegistryError.registryNotFound(
                this.registryPath,
                'Registry not loaded. Call loadRegistry() first or use async methods.'
            );
        }

        return this.registry.agents.some((a) => a.id === id);
    }
}
