import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { logger } from '@core/logger/index.js';
import { resolveBundledScript, getDextoGlobalPath } from '@core/utils/path.js';
import { Registry, RegistrySchema, AgentRegistry } from './types.js';

/**
 * Local agent registry implementation
 */
export class LocalAgentRegistry implements AgentRegistry {
    private _registry: Registry | null = null;

    /**
     * Lazy load registry from JSON file
     */
    private getRegistry(): Registry {
        if (this._registry === null) {
            this._registry = this.loadRegistry();
        }
        return this._registry;
    }

    /**
     * Load registry from bundled JSON file
     */
    private loadRegistry(): Registry {
        let jsonPath: string;

        try {
            jsonPath = resolveBundledScript('agents/agent-registry.json');
        } catch (error) {
            logger.error(`Failed to resolve agent registry path: ${error}`);
            return { version: '1.0.0', agents: {} };
        }

        if (!existsSync(jsonPath)) {
            logger.debug(`Agent registry not found at: ${jsonPath}`);
            return { version: '1.0.0', agents: {} };
        }

        try {
            const jsonData = readFileSync(jsonPath, 'utf-8');
            const rawRegistry = JSON.parse(jsonData);
            return RegistrySchema.parse(rawRegistry);
        } catch (error) {
            logger.error(`Failed to load registry from ${jsonPath}: ${error}`);
            return { version: '1.0.0', agents: {} };
        }
    }

    /**
     * Check if string looks like a path vs registry name
     */
    private isPath(str: string): boolean {
        // Absolute paths
        if (path.isAbsolute(str)) return true;

        // Relative paths with separators
        if (/[\\/]/.test(str)) return true;

        // File extensions
        if (/\.(ya?ml|json)$/i.test(str)) return true;

        return false;
    }

    /**
     * Check if agent exists in registry
     */
    private hasRegistryAgent(name: string): boolean {
        const registry = this.getRegistry();
        return name in registry.agents;
    }

    /**
     * Resolve main config file for directory agent
     */
    private resolveMainConfig(agentDir: string, agentName: string): string {
        const registry = this.getRegistry();
        const agentData = registry.agents[agentName];

        if (!agentData?.main) {
            throw new Error(
                `Registry entry for '${agentName}' specifies directory but missing 'main' field`
            );
        }

        const mainConfigPath = path.join(agentDir, agentData.main);
        if (!existsSync(mainConfigPath)) {
            throw new Error(`Main config file not found: ${mainConfigPath}`);
        }

        return mainConfigPath;
    }

    /**
     * Resolve an agent name/path to a config path
     */
    async resolveAgent(nameOrPath: string): Promise<string> {
        logger.debug(`Resolving agent: ${nameOrPath}`);

        // 1. Check if it's a path - resolve directly
        if (this.isPath(nameOrPath)) {
            const resolved = path.resolve(nameOrPath);
            if (!existsSync(resolved)) {
                throw new Error(`Agent config not found: ${resolved}`);
            }
            logger.debug(`Resolved path '${nameOrPath}' to: ${resolved}`);
            return resolved;
        }

        // 2. Must be a registry name - check if installed
        const globalAgentsDir = getDextoGlobalPath('agents');
        const installedPath = path.join(globalAgentsDir, nameOrPath);

        if (existsSync(installedPath)) {
            const mainConfig = this.resolveMainConfig(installedPath, nameOrPath);
            logger.debug(`Resolved installed agent '${nameOrPath}' to: ${mainConfig}`);
            return mainConfig;
        }

        // 3. Check if available in registry (will need installation next)
        if (this.hasRegistryAgent(nameOrPath)) {
            throw new Error(
                `Agent '${nameOrPath}' not installed yet - installation not implemented`
            );
        }

        // 4. Not found anywhere
        const registry = this.getRegistry();
        const available = Object.keys(registry.agents);
        throw new Error(
            `Agent '${nameOrPath}' not found. ` +
                `Available agents: ${available.join(', ')}. ` +
                `Use a file path for custom agents.`
        );
    }
}
