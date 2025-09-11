import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@core/logger/index.js';
import { resolveBundledScript, getDextoGlobalPath, copyDirectory } from '@core/utils/path.js';
import { loadGlobalPreferences } from '@core/preferences/loader.js';
import { writePreferencesToAgent } from '@core/config/writer.js';
import { Registry, RegistrySchema, AgentRegistry, AgentRegistryEntry } from './types.js';
import { RegistryError } from './errors.js';

// Cached registry instance
let cachedRegistry: LocalAgentRegistry | null = null;

/**
 * Local agent registry implementation
 */
export class LocalAgentRegistry implements AgentRegistry {
    private _registry: Registry | null = null;

    /**
     * Lazy load registry from JSON file
     */
    getRegistry(): Registry {
        if (this._registry === null) {
            this._registry = this.loadRegistry();
        }
        return this._registry;
    }

    /**
     * Load registry from bundled JSON file
     * Uses fail-fast approach - throws RegistryError for any loading issues
     */
    private loadRegistry(): Registry {
        let jsonPath: string;

        try {
            jsonPath = resolveBundledScript('agents/agent-registry.json');
        } catch (_error) {
            // Preserve typed error semantics for missing registry
            throw RegistryError.registryNotFound(
                'agents/agent-registry.json (bundle resolution failed)'
            );
        }

        if (!existsSync(jsonPath)) {
            throw RegistryError.registryNotFound(jsonPath);
        }

        try {
            const jsonData = readFileSync(jsonPath, 'utf-8');
            const rawRegistry = JSON.parse(jsonData);
            return RegistrySchema.parse(rawRegistry);
        } catch (error) {
            throw RegistryError.registryParseError(
                jsonPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Check if agent exists in registry
     */
    hasAgent(name: string): boolean {
        const registry = this.getRegistry();
        return name in registry.agents;
    }

    /**
     * Get available agents with their metadata from registry
     */
    getAvailableAgents(): Record<string, AgentRegistryEntry> {
        const registry = this.getRegistry();
        return registry.agents;
    }

    /**
     * Resolve main config file for installed agent
     * Handles both directory agents (with main field) and single-file agents
     */
    resolveMainConfig(agentDir: string, agentName: string): string {
        const registry = this.getRegistry();
        const agentData = registry.agents[agentName];

        if (!agentData) {
            const available = Object.keys(registry.agents);
            throw RegistryError.agentNotFound(agentName, available);
        }

        if (agentData.source.endsWith('/')) {
            // Directory agent - main field is required
            if (!agentData.main) {
                throw RegistryError.agentInvalidEntry(
                    agentName,
                    'directory entry missing main field'
                );
            }

            const mainConfigPath = path.join(agentDir, agentData.main);
            if (!existsSync(mainConfigPath)) {
                throw RegistryError.mainConfigMissing(agentName, mainConfigPath);
            }

            return mainConfigPath;
        } else {
            // Single file agent - use the source filename
            const filename = path.basename(agentData.source);
            const configPath = path.join(agentDir, filename);

            if (!existsSync(configPath)) {
                throw RegistryError.configNotFound(configPath);
            }

            return configPath;
        }
    }

    /**
     * Install agent atomically using temp + rename pattern
     * @param agentName Name of the agent to install
     * @param injectPreferences Whether to inject global preferences into installed agent (default: true)
     */
    async installAgent(agentName: string, injectPreferences: boolean = true): Promise<string> {
        logger.info(`Installing agent: ${agentName}`);
        const registry = this.getRegistry();
        const agentData = registry.agents[agentName];

        if (!agentData) {
            const available = Object.keys(registry.agents);
            throw RegistryError.agentNotFound(agentName, available);
        }

        const globalAgentsDir = getDextoGlobalPath('agents');
        const targetDir = path.join(globalAgentsDir, agentName);

        // Check if already installed
        if (existsSync(targetDir)) {
            logger.info(`Agent '${agentName}' already installed`);
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
                throw RegistryError.installationValidationFailed(agentName, mainConfigPath);
            }

            // Atomic rename
            await fs.rename(tempDir, targetDir);

            logger.info(`✓ Installed agent '${agentName}' to ${targetDir}`);

            // Inject global preferences if requested
            if (injectPreferences) {
                try {
                    const preferences = await loadGlobalPreferences();
                    await writePreferencesToAgent(targetDir, preferences);
                    logger.info(`✓ Applied global preferences to installed agent '${agentName}'`);
                } catch (error) {
                    // Log warning but don't fail installation if preference injection fails
                    logger.warn(
                        `Failed to inject preferences to '${agentName}': ${error instanceof Error ? error.message : String(error)}`
                    );
                    console.log(
                        `⚠️  Warning: Could not apply preferences to '${agentName}' - agent will use bundled settings`
                    );
                }
            } else {
                logger.info(
                    `Skipped preference injection for '${agentName}' (injectPreferences=false)`
                );
            }

            return this.resolveMainConfig(targetDir, agentName);
        } catch (error) {
            // Clean up temp directory on failure
            try {
                if (existsSync(tempDir)) {
                    await fs.rm(tempDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                logger.error(
                    `Failed to clean up temp directory: ${cleanupError}. Skipping cleanup...`
                );
            }

            throw RegistryError.installationFailed(
                agentName,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Resolve a registry agent name to a config path
     * NOTE: Only handles registry names, not file paths (routing done in loadAgentConfig)
     * Handles installing agent if needed
     * @param agentName Name of the agent to resolve
     * @param autoInstall Whether to automatically install missing agents from registry (default: true)
     * @param injectPreferences Whether to inject preferences during auto-installation (default: true)
     */
    async resolveAgent(
        agentName: string,
        autoInstall: boolean = true,
        injectPreferences: boolean = true
    ): Promise<string> {
        logger.debug(`Resolving registry agent: ${agentName}`);

        // 1. Check if installed
        const globalAgentsDir = getDextoGlobalPath('agents');
        const installedPath = path.join(globalAgentsDir, agentName);

        if (existsSync(installedPath)) {
            const mainConfig = this.resolveMainConfig(installedPath, agentName);
            logger.debug(`Resolved installed agent '${agentName}' to: ${mainConfig}`);
            return mainConfig;
        }

        logger.debug(`Agent '${agentName}' not found in installed path: ${installedPath}`);

        // 2. Check if available in registry
        if (this.hasAgent(agentName)) {
            if (autoInstall) {
                logger.info(`Installing agent '${agentName}' from registry...`);
                return await this.installAgent(agentName, injectPreferences);
            } else {
                // Agent is available in registry but auto-install is disabled
                const registry = this.getRegistry();
                const available = Object.keys(registry.agents);
                throw RegistryError.agentNotInstalledAutoInstallDisabled(agentName, available);
            }
        }

        // 3. Not found in registry
        const registry = this.getRegistry();
        const available = Object.keys(registry.agents);
        throw RegistryError.agentNotFound(agentName, available);
    }

    /**
     * Get list of currently installed agents
     */
    async getInstalledAgents(): Promise<string[]> {
        const globalAgentsDir = getDextoGlobalPath('agents');

        if (!existsSync(globalAgentsDir)) {
            return [];
        }

        try {
            const entries = await fs.readdir(globalAgentsDir, { withFileTypes: true });
            return (
                entries
                    .filter((entry) => entry.isDirectory())
                    .map((entry) => entry.name)
                    // Exclude temp directories both when prefixed and suffixed (agentName.tmp.<ts>)
                    .filter((name) => !name.startsWith('.tmp') && !name.includes('.tmp.'))
            );
        } catch (error) {
            logger.error(`Failed to read installed agents directory: ${error}`);
            return [];
        }
    }

    /**
     * Check if an agent is safe to uninstall (not the default-agent which is critical)
     */
    private isAgentSafeToUninstall(agentName: string): boolean {
        // Protect the default-agent as it's critical for CLI operation
        return agentName !== 'default-agent';
    }

    /**
     * Uninstall an agent by removing its directory
     * @param agentName Name of the agent to uninstall
     * @param force Whether to force uninstall even if agent is protected (default: false)
     */
    async uninstallAgent(agentName: string, force: boolean = false): Promise<void> {
        const globalAgentsDir = getDextoGlobalPath('agents');
        const agentDir = path.join(globalAgentsDir, agentName);
        logger.info(`Uninstalling agent: ${agentName} from ${agentDir}`);

        if (!existsSync(agentDir)) {
            throw RegistryError.agentNotInstalled(agentName);
        }

        // Safety check for default-agent unless forced
        if (!force && !this.isAgentSafeToUninstall(agentName)) {
            throw RegistryError.agentProtected(agentName);
        }

        try {
            await fs.rm(agentDir, { recursive: true, force: true });
            logger.info(`✓ Removed agent '${agentName}' from ${agentDir}`);
        } catch (error) {
            throw RegistryError.uninstallationFailed(
                agentName,
                error instanceof Error ? error.message : String(error)
            );
        }
    }
}

/**
 * Get cached registry instance (singleton pattern)
 */
export function getAgentRegistry(): LocalAgentRegistry {
    if (cachedRegistry === null) {
        cachedRegistry = new LocalAgentRegistry();
    }
    return cachedRegistry;
}
