import { promises as fs } from 'fs';
import { getDextoGlobalPath, resolveBundledScript } from './utils/path.js';
import { deriveDisplayName } from './registry/types.js';
import {
    installBundledAgent,
    installCustomAgent,
    uninstallAgent,
    type InstallOptions,
} from './installation.js';
import type { AgentMetadata } from './AgentManager.js';

/**
 * Static API for agent management operations
 * Provides convenient methods for listing, installing, and uninstalling agents
 */
export const Dexto = {
    /**
     * List all agents (installed and available from bundled registry)
     */
    async listAgents() {
        const bundledRegistry = await loadBundledRegistry();
        const installed = await listInstalledAgents();

        // Build installed agent list
        const installedAgents = installed.map((id) => {
            const bundledEntry = bundledRegistry.agents[id];
            return {
                id,
                name: bundledEntry?.name || deriveDisplayName(id),
                description: bundledEntry?.description || '',
                author: bundledEntry?.author || '',
                tags: bundledEntry?.tags || [],
                type: bundledEntry ? ('builtin' as const) : ('custom' as const),
            };
        });

        // Build available agent list (not installed)
        const availableAgents = Object.entries(bundledRegistry.agents)
            .filter(([id]) => !installed.includes(id))
            .map(([id, entry]: [string, any]) => ({
                id,
                name: entry.name,
                description: entry.description || '',
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
        injectPreferences?: boolean | InstallOptions
    ): Promise<string> {
        // Handle backward compatibility: injectPreferences can be boolean or InstallOptions
        const options: InstallOptions =
            typeof injectPreferences === 'boolean'
                ? { injectPreferences }
                : injectPreferences || {};

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
};

// Helper functions
async function loadBundledRegistry() {
    const bundledRegistryPath = resolveBundledScript('agents/agent-registry.json');
    const content = await fs.readFile(bundledRegistryPath, 'utf-8');
    return JSON.parse(content);
}

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
