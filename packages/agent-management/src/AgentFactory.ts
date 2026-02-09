/**
 * AgentFactory - Static convenience API for agent operations
 *
 * USE THIS WHEN: You need a simple, direct way to create agents or manage installations.
 * No registry file required for agent creation.
 *
 * Key methods:
 * - `AgentFactory.createAgent(config)` - Create agent from inline config (DB, API, dynamic)
 * - `AgentFactory.installAgent(id)` - Install agent from bundled registry
 * - `AgentFactory.uninstallAgent(id)` - Remove installed agent
 * - `AgentFactory.listAgents()` - List installed/available agents
 *
 * Examples:
 * - SaaS platforms with per-tenant configs from database
 * - Dynamically constructed agent configurations
 * - Quick scripts and demos
 * - Single-agent applications
 *
 * FOR REGISTRY-BASED MULTI-AGENT SCENARIOS: Use `AgentManager` instead.
 * This is better when you have a registry.json with multiple predefined agents
 * and need discovery/selection capabilities.
 *
 * @see AgentManager for registry-based agent management
 * @see https://docs.dexto.ai/api/sdk/agent-factory for full documentation
 */

import { promises as fs } from 'fs';
import { AgentConfigSchema, DextoAgent, type AgentConfig } from '@dexto/core';
import { getDextoGlobalPath } from './utils/path.js';
import { deriveDisplayName } from './registry/types.js';
import { loadBundledRegistryAgents } from './registry/registry.js';
import { enrichAgentConfig } from './config/index.js';
import {
    installBundledAgent,
    installCustomAgent,
    uninstallAgent,
    type InstallOptions,
} from './installation.js';
import type { AgentMetadata } from './AgentManager.js';

/**
 * Options for listing agents
 */
export interface ListAgentsOptions {
    /** Fallback description when not provided */
    descriptionFallback?: string;
    /** Fallback description for custom agents */
    customAgentDescriptionFallback?: string;
}

/**
 * Options for creating an agent from inline config
 */
export interface CreateAgentOptions {
    /** Override agent ID (otherwise derived from agentCard.name or defaults to 'inline-agent') */
    agentId?: string;
    /** Whether this is interactive CLI mode (affects logger defaults) */
    isInteractiveCli?: boolean;
}

/**
 * Static API for agent management operations
 * Provides convenient methods for listing, installing, and uninstalling agents
 */
export const AgentFactory = {
    /**
     * List all agents (installed and available from bundled registry)
     * @param options - Optional fallback values for descriptions
     */
    async listAgents(options?: ListAgentsOptions) {
        const bundledAgents = loadBundledRegistryAgents();
        const installed = await listInstalledAgents();
        const descriptionFallback = options?.descriptionFallback ?? '';
        const customAgentDescriptionFallback =
            options?.customAgentDescriptionFallback ?? descriptionFallback;

        // Build installed agent list
        const installedAgents = installed.map((id) => {
            const bundledEntry = bundledAgents[id];
            return {
                id,
                name: bundledEntry?.name || deriveDisplayName(id),
                description:
                    bundledEntry?.description ||
                    (bundledEntry ? descriptionFallback : customAgentDescriptionFallback),
                author: bundledEntry?.author || '',
                tags: bundledEntry?.tags || [],
                type: bundledEntry ? ('builtin' as const) : ('custom' as const),
            };
        });

        // Build available agent list (not installed)
        const installedSet = new Set(installed);
        const availableAgents = Object.entries(bundledAgents)
            .filter(([id]) => !installedSet.has(id))
            .map(([id, entry]: [string, any]) => ({
                id,
                name: entry.name,
                description: entry.description || descriptionFallback,
                author: entry.author || '',
                tags: entry.tags || [],
                type: 'builtin' as const,
            }));

        return {
            installed: installedAgents,
            available: availableAgents,
        };
    },

    /**
     * Install an agent from the bundled registry
     */
    async installAgent(agentId: string, options?: InstallOptions): Promise<string> {
        return installBundledAgent(agentId, options);
    },

    /**
     * Install a custom agent from local path
     */
    async installCustomAgent(
        agentId: string,
        sourcePath: string,
        metadata: Pick<AgentMetadata, 'name' | 'description' | 'author' | 'tags'>,
        options?: InstallOptions
    ): Promise<string> {
        return installCustomAgent(agentId, sourcePath, metadata, options);
    },

    /**
     * Uninstall an agent
     * @param agentId - Agent ID to uninstall
     * @param _force - Deprecated: force parameter is kept for backward compatibility but has no effect
     */
    async uninstallAgent(agentId: string, _force?: boolean): Promise<void> {
        return uninstallAgent(agentId);
    },

    /**
     * Create an agent from an inline configuration object
     *
     * Use this when you have a config from a database, API, or constructed programmatically
     * and don't need a registry file. The agent is returned unstarted.
     *
     * @param config - Agent configuration object
     * @param options - Optional creation options
     * @returns Promise resolving to DextoAgent instance (not started)
     *
     * @example
     * ```typescript
     * // Create from inline config
     * const agent = await AgentFactory.createAgent({
     *   llm: {
     *     provider: 'openai',
     *     model: 'gpt-4o',
     *     apiKey: process.env.OPENAI_API_KEY
     *   },
     *   systemPrompt: 'You are a helpful assistant.'
     * });
     * await agent.start();
     *
     * // With custom agent ID (affects log/storage paths)
     * const agent = await AgentFactory.createAgent(config, { agentId: 'my-custom-agent' });
     *
     * // From database
     * const configFromDb = await db.getAgentConfig(userId);
     * const agent = await AgentFactory.createAgent(configFromDb, { agentId: `user-${userId}` });
     * ```
     */
    async createAgent(config: AgentConfig, options?: CreateAgentOptions): Promise<DextoAgent> {
        // If agentId provided, inject it into config's agentCard.name for enrichment
        // This affects path derivation in enrichAgentConfig
        let configToEnrich = config;
        if (options?.agentId) {
            configToEnrich = {
                ...config,
                agentCard: {
                    ...(config.agentCard || {}),
                    name: options.agentId,
                },
            } as AgentConfig;
        }

        // Enrich with runtime paths (logs, database, blob storage)
        const enrichedConfig = enrichAgentConfig(
            configToEnrich,
            undefined, // No config path for inline configs
            options?.isInteractiveCli ?? false
        );

        // Create and return unstarted agent
        const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
        return new DextoAgent({ config: validatedConfig });
    },
};

// Helper functions
async function listInstalledAgents(): Promise<string[]> {
    const agentsDir = getDextoGlobalPath('agents');
    try {
        const entries = await fs.readdir(agentsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
