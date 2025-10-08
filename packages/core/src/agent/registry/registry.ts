import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@core/logger/index.js';
import { resolveBundledScript, getDextoGlobalPath, copyDirectory } from '@core/utils/path.js';
import { loadGlobalPreferences } from '@core/preferences/loader.js';
import { writePreferencesToAgent } from '@core/config/writer.js';
import {
    Registry,
    RegistrySchema,
    AgentRegistry,
    AgentRegistryEntry,
    normalizeRegistryJson,
} from './types.js';
import { RegistryError } from './errors.js';
import {
    loadUserRegistry,
    mergeRegistries,
    removeAgentFromUserRegistry,
    addAgentToUserRegistry,
} from './user-registry.js';

// Cached registry instance
let cachedRegistry: LocalAgentRegistry | null = null;

/**
 * Local agent registry implementation
 *
 * TODO: ARCHITECTURAL REFACTOR - Move registry, preferences, and agent resolution to CLI
 *
 * PROBLEM: Registry operations are CLI concerns but live in Core, causing:
 * - Missing analytics for auto-install (when running `dexto`, registry installs agents but doesn't track)
 * - Wrong separation of concerns (Core = execution engine, not discovery/setup)
 * - Registry manages ~/.dexto/agents filesystem which is CLI-level setup
 *
 * THE RIGHT ARCHITECTURE:
 *
 * Move to CLI:
 * 1. Agent Registry (packages/core/src/agent/registry/) → packages/cli/src/registry/
 *    - installAgent(), uninstallAgent(), resolveAgent(), listAgents()
 *    - Can directly call capture() for analytics
 *    - Manages ~/.dexto/agents installation directory
 *
 * 2. Global Preferences (packages/core/src/preferences/) → packages/cli/src/preferences/
 *    - User's default LLM, model, default agent
 *    - Used by `dexto setup` command
 *    - Manages ~/.dexto/preferences.json
 *
 * 3. Agent Resolution (packages/core/src/config/agent-resolver.ts) → packages/cli/src/agent-resolver.ts
 *    - Discovery logic: check registry, trigger installs, apply preferences
 *    - Returns resolved config PATH to core
 *
 * Core keeps:
 * - config/loader.ts - Load YAML from path
 * - config/schemas.ts - Zod validation
 * - Agent execution (DextoAgent, LLM, tools, MCP)
 *
 * FLOW AFTER REFACTOR:
 * CLI index.ts:
 *   → CLI: resolveAgentPath() (discovery logic)
 *     → CLI: registry.resolveAgent()
 *       → CLI: registry.installAgent() if needed
 *       → CLI: capture('dexto_install_agent', ...) ✓ Natural!
 *   → Core: new DextoAgent(configPath) (just loads & runs)
 *
 * BENEFITS:
 * - Clear separation: CLI = setup/discovery, Core = execution
 * - Analytics naturally colocated with operations
 * - Core is portable (no CLI dependencies)
 * - No circular deps (CLI → Core, correct direction)
 *
 * ESTIMATE: ~3-4 hours (mostly moving code + updating imports)
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
     * Load and merge bundled + user registries
     * Uses fail-fast approach - throws RegistryError for any loading issues
     */
    private loadRegistry(): Registry {
        // Load bundled registry
        let jsonPath: string;

        try {
            jsonPath = resolveBundledScript('agents/agent-registry.json');
        } catch (error) {
            // Preserve typed error semantics for missing registry
            throw RegistryError.registryNotFound(
                'agents/agent-registry.json',
                error instanceof Error ? error.message : String(error)
            );
        }

        if (!existsSync(jsonPath)) {
            throw RegistryError.registryNotFound(jsonPath, "File doesn't exist");
        }

        let bundledRegistry: Registry;
        try {
            const jsonData = readFileSync(jsonPath, 'utf-8');
            const rawRegistry = JSON.parse(jsonData);
            bundledRegistry = RegistrySchema.parse(normalizeRegistryJson(rawRegistry));
        } catch (error) {
            throw RegistryError.registryParseError(
                jsonPath,
                error instanceof Error ? error.message : String(error)
            );
        }

        // Load user registry and merge
        const userRegistry = loadUserRegistry();
        const merged = mergeRegistries(bundledRegistry, userRegistry);

        logger.debug(
            `Loaded registry: ${Object.keys(bundledRegistry.agents).length} bundled, ${Object.keys(userRegistry.agents).length} custom`
        );

        return merged;
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
     * Validate custom agent name doesn't conflict with bundled registry
     * @throws RegistryError if name conflicts
     */
    private validateCustomAgentName(agentName: string): void {
        // Load bundled registry directly to check conflicts
        const jsonPath = resolveBundledScript('agents/agent-registry.json');
        const jsonData = readFileSync(jsonPath, 'utf-8');
        const bundledRegistry = RegistrySchema.parse(normalizeRegistryJson(JSON.parse(jsonData)));

        if (agentName in bundledRegistry.agents) {
            throw RegistryError.customAgentNameConflict(agentName);
        }
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
                    `Failed to clean up temp directory: ${
                        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
                    }. Skipping cleanup...`
                );
            }

            throw RegistryError.installationFailed(
                agentName,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Install a custom agent from a local file path
     * @param agentName Unique name for the custom agent
     * @param sourcePath Absolute path to agent YAML file or directory
     * @param metadata Agent metadata (name, description, author, tags, main)
     * @param injectPreferences Whether to inject global preferences (default: true)
     * @returns Path to the installed agent's main config file
     */
    async installCustomAgentFromPath(
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
        logger.info(`Installing custom agent '${agentName}' from ${sourcePath}`);

        // Validate agent name doesn't conflict with bundled registry
        this.validateCustomAgentName(agentName);

        // Check if source exists
        if (!existsSync(sourcePath)) {
            throw RegistryError.configNotFound(sourcePath);
        }

        const globalAgentsDir = getDextoGlobalPath('agents');
        const targetDir = path.join(globalAgentsDir, agentName);

        // Check if already installed
        if (existsSync(targetDir)) {
            throw RegistryError.agentAlreadyExists(agentName);
        }

        // Ensure agents directory exists
        await fs.mkdir(globalAgentsDir, { recursive: true });

        // Determine if source is file or directory
        const stats = await fs.stat(sourcePath);
        const isDirectory = stats.isDirectory();

        // For single-file agents, use agent name for filename
        const configFileName = isDirectory ? undefined : `${agentName}.yml`;

        // Validate metadata
        if (!metadata.description) {
            throw RegistryError.installationFailed(agentName, 'description is required');
        }
        if (isDirectory && !metadata.main) {
            throw RegistryError.installationFailed(
                agentName,
                'main field is required for directory-based agents'
            );
        }

        // Build registry entry
        // Auto-generate display name from ID if not provided
        const displayName =
            metadata.name ||
            agentName
                .split('-')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

        const registryEntry: Omit<AgentRegistryEntry, 'type'> = {
            id: agentName,
            name: displayName,
            description: metadata.description,
            author: metadata.author,
            tags: metadata.tags,
            source: isDirectory ? `${agentName}/` : configFileName!,
            main: metadata.main,
        };

        // Create temp directory for atomic operation
        const tempDir = `${targetDir}.tmp.${Date.now()}`;

        try {
            // Copy to temp directory first
            if (isDirectory) {
                await copyDirectory(sourcePath, tempDir);
            } else {
                await fs.mkdir(tempDir, { recursive: true });
                const targetFile = path.join(tempDir, configFileName!);
                await fs.copyFile(sourcePath, targetFile);
            }

            // Validate installation - check main config exists
            // After validation above, we know metadata.main exists for directories
            const tempMainConfigPath = isDirectory
                ? path.join(tempDir, metadata.main!)
                : path.join(tempDir, configFileName!);

            if (!existsSync(tempMainConfigPath)) {
                throw RegistryError.installationValidationFailed(agentName, tempMainConfigPath);
            }

            // Atomic rename
            await fs.rename(tempDir, targetDir);

            logger.info(`✓ Installed custom agent '${agentName}' to ${targetDir}`);

            // Calculate final main config path after rename
            const mainConfigPath =
                isDirectory && metadata.main
                    ? path.join(targetDir, metadata.main)
                    : path.join(targetDir, configFileName!);

            // Add to user registry (with rollback on failure)
            try {
                await addAgentToUserRegistry(agentName, registryEntry);
                logger.info(`✓ Added '${agentName}' to user registry`);

                // Clear cached registry to force reload
                this._registry = null;
            } catch (registryError) {
                // Rollback: remove installed directory
                try {
                    if (existsSync(targetDir)) {
                        await fs.rm(targetDir, { recursive: true, force: true });
                        logger.info(`Rolled back installation: removed ${targetDir}`);
                    }
                } catch (rollbackError) {
                    logger.error(
                        `Rollback failed for '${agentName}': ${
                            rollbackError instanceof Error
                                ? rollbackError.message
                                : String(rollbackError)
                        }`
                    );
                }
                // Re-throw original registry error
                throw registryError;
            }

            // Inject global preferences if requested
            if (injectPreferences) {
                try {
                    const preferences = await loadGlobalPreferences();
                    await writePreferencesToAgent(targetDir, preferences);
                    logger.info(`✓ Applied global preferences to custom agent '${agentName}'`);
                } catch (error) {
                    logger.warn(
                        `Failed to inject preferences to '${agentName}': ${error instanceof Error ? error.message : String(error)}`
                    );
                    console.log(
                        `⚠️  Warning: Could not apply preferences to '${agentName}' - agent will use default settings`
                    );
                }
            }

            return mainConfigPath;
        } catch (error) {
            // Clean up temp directory on failure
            try {
                if (existsSync(tempDir)) {
                    await fs.rm(tempDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                logger.error(
                    `Failed to clean up temp directory: ${
                        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
                    }. Skipping cleanup...`
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
     * Check if an agent is safe to uninstall (not the default agent from preferences)
     */
    private async isAgentSafeToUninstall(agentName: string): Promise<boolean> {
        try {
            const preferences = await loadGlobalPreferences();
            const defaultAgent = preferences.defaults.defaultAgent;
            return agentName !== defaultAgent;
        } catch {
            // If preferences can't be loaded, protect 'default-agent' as fallback
            logger.warn('Could not load preferences, using fallback protection for default-agent');
            return agentName !== 'default-agent';
        }
    }

    /**
     * Uninstall an agent by removing its directory
     * For custom agents: also removes from user registry
     * For builtin agents: only removes from disk
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

        // Safety check for default agent unless forced
        if (!force && !(await this.isAgentSafeToUninstall(agentName))) {
            throw RegistryError.agentProtected(agentName);
        }

        // Check if this is a custom agent (exists in user registry)
        const registry = this.getRegistry();
        const agentData = registry.agents[agentName];
        const isCustomAgent = agentData?.type === 'custom';

        try {
            // Remove from disk
            await fs.rm(agentDir, { recursive: true, force: true });
            logger.info(`✓ Removed agent '${agentName}' from ${agentDir}`);

            // If custom agent, also remove from user registry
            if (isCustomAgent) {
                await removeAgentFromUserRegistry(agentName);
                logger.info(`✓ Removed custom agent '${agentName}' from user registry`);

                // Clear cached registry to force reload
                this._registry = null;
            }
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
