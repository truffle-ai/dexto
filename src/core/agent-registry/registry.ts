import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@core/logger/index.js';
import { resolveBundledScript, getDextoGlobalPath, copyDirectory } from '@core/utils/path.js';
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
     * Install agent atomically using temp + rename pattern
     */
    private async installAgent(agentName: string): Promise<string> {
        const registry = this.getRegistry();
        const agentData = registry.agents[agentName];

        if (!agentData) {
            throw new Error(`Agent '${agentName}' not found in registry`);
        }

        const globalAgentsDir = getDextoGlobalPath('agents');
        const targetDir = path.join(globalAgentsDir, agentName);

        // Check if already installed
        if (existsSync(targetDir)) {
            logger.debug(`Agent '${agentName}' already installed`);
            return this.resolveMainConfig(targetDir, agentName);
        }

        // Ensure agents directory exists
        await fs.mkdir(globalAgentsDir, { recursive: true });

        // Determine source path
        const sourcePath = resolveBundledScript(`agents/${agentData.source}`);

        // Create temp directory for atomic operation
        const tempDir = `${targetDir}.tmp.${Date.now()}`;

        try {
            // Copy to temp directory first
            if (agentData.source.endsWith('/')) {
                // Directory agent - copy entire directory
                await copyDirectory(sourcePath, tempDir);
            } else {
                // Single file agent - create directory and copy file
                await fs.mkdir(tempDir, { recursive: true });
                const targetFile = path.join(tempDir, path.basename(sourcePath));
                await fs.copyFile(sourcePath, targetFile);
            }

            // Validate installation
            const mainConfigPath = this.resolveMainConfig(tempDir, agentName);
            if (!existsSync(mainConfigPath)) {
                throw new Error(`Installation validation failed: missing main config`);
            }

            // Atomic rename
            await fs.rename(tempDir, targetDir);

            logger.info(`✓ Installed agent '${agentName}' to ${targetDir}`);
            return this.resolveMainConfig(targetDir, agentName);
        } catch (error) {
            // Clean up temp directory on failure
            try {
                if (existsSync(tempDir)) {
                    await fs.rm(tempDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                logger.debug(`Failed to clean up temp directory: ${cleanupError}`);
            }

            throw new Error(
                `Failed to install agent '${agentName}': ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Resolve a registry agent name to a config path
     * NOTE: Only handles registry names, not file paths (routing done in loadAgentConfig)
     */
    async resolveAgent(agentName: string): Promise<string> {
        logger.debug(`Resolving registry agent: ${agentName}`);

        // 1. Check if installed
        const globalAgentsDir = getDextoGlobalPath('agents');
        const installedPath = path.join(globalAgentsDir, agentName);

        if (existsSync(installedPath)) {
            const mainConfig = this.resolveMainConfig(installedPath, agentName);
            logger.debug(`Resolved installed agent '${agentName}' to: ${mainConfig}`);
            return mainConfig;
        }

        // 2. Check if available in registry - install if needed
        if (this.hasRegistryAgent(agentName)) {
            logger.info(`Installing agent '${agentName}' from registry...`);
            return await this.installAgent(agentName);
        }

        // 3. Not found in registry
        const registry = this.getRegistry();
        const available = Object.keys(registry.agents);
        throw new Error(
            `Agent '${agentName}' not found. ` +
                `Available agents: ${available.join(', ')}. ` +
                `Use a file path for custom agents.`
        );
    }
}
