// packages/agent-management/src/resolver.ts

import { promises as fs } from 'fs';
import path from 'path';
import { isPath, getDextoGlobalPath, resolveBundledScript } from './utils/path.js';
import {
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
} from './utils/execution-context.js';
import { logger } from '@dexto/core';
import { loadGlobalPreferences, globalPreferencesExist } from './preferences/loader.js';
import { ConfigError } from './config/index.js';
import { RegistryError } from './registry/errors.js';
import { AgentManager } from './AgentManager.js';
import { installBundledAgent } from './installation.js';

/**
 * Entry in the installed agents registry (registry.json)
 */
interface InstalledAgentEntry {
    id: string;
    name: string;
    description: string;
    configPath: string;
    author: string;
    tags: string[];
}

/**
 * Installed agents registry format
 */
interface InstalledRegistry {
    agents: InstalledAgentEntry[];
}

/**
 * Resolve agent path with automatic installation if needed
 * @param nameOrPath Optional agent name or explicit path
 * @param autoInstall Whether to automatically install missing agents from bundled registry (default: true)
 * @returns Resolved absolute path to agent config
 * @throws {ConfigError} For path/config issues (file not found, unknown context, setup incomplete)
 * @throws {RegistryError} For agent lookup failures (agent not found, not installed)
 */
export async function resolveAgentPath(
    nameOrPath?: string,
    autoInstall: boolean = true
): Promise<string> {
    // 1. Handle explicit paths (highest priority)
    if (nameOrPath && isPath(nameOrPath)) {
        const resolved = path.resolve(nameOrPath);
        // Verify an actual file exists - fail fast if not
        try {
            const stat = await fs.stat(resolved);
            if (!stat.isFile()) {
                throw ConfigError.fileNotFound(resolved);
            }
            return resolved;
        } catch {
            throw ConfigError.fileNotFound(resolved);
        }
    }

    // 2. Handle agent names from installed registry
    if (nameOrPath) {
        return await resolveAgentByName(nameOrPath, autoInstall);
    }

    // 3. Default agent resolution based on execution context
    return await resolveDefaultAgentByContext(autoInstall);
}

/**
 * Resolve agent by name from installed or bundled registry
 */
async function resolveAgentByName(agentId: string, autoInstall: boolean): Promise<string> {
    const agentsDir = getDextoGlobalPath('agents');
    const installedRegistryPath = path.join(agentsDir, 'registry.json');

    // Check if installed
    try {
        const manager = new AgentManager(installedRegistryPath);
        await manager.loadRegistry();
        if (manager.hasAgent(agentId)) {
            const agentPath = await getAgentConfigPath(agentId);
            return agentPath;
        }
    } catch (error) {
        // Registry doesn't exist or agent not found, continue to auto-install
        logger.debug(`Agent '${agentId}' not found in installed registry: ${error}`);
    }

    // Auto-install from bundled if available
    if (autoInstall) {
        try {
            logger.info(`Auto-installing agent '${agentId}' from bundled registry`);
            const configPath = await installBundledAgent(agentId);
            return configPath;
        } catch (error) {
            // installBundledAgent throws RegistryError.agentNotFound if not in bundled registry
            // Re-throw with context that we checked both registries
            logger.debug(`Failed to auto-install agent '${agentId}': ${error}`);
            throw RegistryError.agentNotFound(agentId, []);
        }
    }

    throw RegistryError.agentNotInstalledAutoInstallDisabled(agentId, []);
}

/**
 * Get config path for an agent from the installed registry
 */
async function getAgentConfigPath(agentId: string): Promise<string> {
    // Extract config path from agent - we need to find the actual config file
    // The agent was created from the config, so we can derive the path from the registry
    const agentsDir = getDextoGlobalPath('agents');
    const installedRegistryPath = path.join(agentsDir, 'registry.json');

    const registryContent = await fs.readFile(installedRegistryPath, 'utf-8');
    const registry = JSON.parse(registryContent) as InstalledRegistry;
    const agentEntry = registry.agents.find((a) => a.id === agentId);

    if (!agentEntry) {
        const available = registry.agents.map((a) => a.id);
        throw RegistryError.agentNotFound(agentId, available);
    }

    return path.resolve(path.dirname(installedRegistryPath), agentEntry.configPath);
}

/**
 * Resolve default agent based on execution context
 */
async function resolveDefaultAgentByContext(autoInstall: boolean = true): Promise<string> {
    const executionContext = getExecutionContext();

    switch (executionContext) {
        case 'dexto-source':
            return await resolveDefaultAgentForDextoSource(autoInstall);

        case 'dexto-project':
            return await resolveDefaultAgentForDextoProject(autoInstall);

        case 'global-cli':
            return await resolveDefaultAgentForGlobalCLI(autoInstall);

        default:
            throw ConfigError.unknownContext(executionContext);
    }
}

/**
 * Resolution for Dexto source code context
 * - Dev mode (DEXTO_DEV_MODE=true): Always use repo config file
 * - User with setup: Use their preferences
 * - Otherwise: Fallback to repo config file
 */
async function resolveDefaultAgentForDextoSource(autoInstall: boolean = true): Promise<string> {
    logger.debug('Resolving default agent for dexto source context');
    const sourceRoot = findDextoSourceRoot();
    if (!sourceRoot) {
        throw ConfigError.bundledNotFound('dexto source directory not found');
    }
    const repoConfigPath = path.join(sourceRoot, 'agents', 'coding-agent', 'coding-agent.yml');

    // Check if we're in dev mode (maintainers testing the repo config)
    const isDevMode = process.env.DEXTO_DEV_MODE === 'true';

    if (isDevMode) {
        logger.debug('Dev mode: using repository config file');
        try {
            await fs.access(repoConfigPath);
            return repoConfigPath;
        } catch {
            throw ConfigError.bundledNotFound(repoConfigPath);
        }
    }

    // Prefer user preferences if setup is complete
    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            if (preferences.setup.completed) {
                logger.debug('Using user preferences in dexto-source context');
                const preferredAgentName = preferences.defaults.defaultAgent;
                return await resolveAgentByName(preferredAgentName, autoInstall);
            }
        } catch (error) {
            logger.warn(`Failed to load preferences, falling back to repo config: ${error}`);
        }
    }

    // Fallback to repo config
    logger.debug('Using repository config (no preferences or setup incomplete)');
    try {
        await fs.access(repoConfigPath);
        return repoConfigPath;
    } catch {
        throw ConfigError.bundledNotFound(repoConfigPath);
    }
}

/**
 * Resolution for Dexto project context - project default OR preferences default
 */
async function resolveDefaultAgentForDextoProject(autoInstall: boolean = true): Promise<string> {
    logger.debug('Resolving default agent for dexto project context');
    const projectRoot = findDextoProjectRoot();
    if (!projectRoot) {
        throw ConfigError.unknownContext('dexto-project: project root not found');
    }

    // 1. Try project-local coding-agent.yml first
    const candidatePaths = [
        path.join(projectRoot, 'coding-agent.yml'),
        path.join(projectRoot, 'agents', 'coding-agent.yml'),
        path.join(projectRoot, 'src', 'dexto', 'agents', 'coding-agent.yml'),
    ];

    for (const p of candidatePaths) {
        try {
            await fs.access(p);
            return p;
        } catch {
            // continue
        }
    }
    logger.debug(`No project-local coding-agent.yml found in ${projectRoot}`);

    // 2. Use preferences default agent name - REQUIRED if no project default
    if (!globalPreferencesExist()) {
        throw ConfigError.noProjectDefault(projectRoot);
    }

    const preferences = await loadGlobalPreferences();

    if (!preferences.setup.completed) {
        throw ConfigError.setupIncomplete();
    }

    const preferredAgentName = preferences.defaults.defaultAgent;
    return await resolveAgentByName(preferredAgentName, autoInstall);
}

/**
 * Resolution for Global CLI context - preferences default REQUIRED
 */
async function resolveDefaultAgentForGlobalCLI(autoInstall: boolean = true): Promise<string> {
    logger.debug('Resolving default agent for global CLI context');
    if (!globalPreferencesExist()) {
        throw ConfigError.noGlobalPreferences();
    }

    const preferences = await loadGlobalPreferences();

    if (!preferences.setup.completed) {
        throw ConfigError.setupIncomplete();
    }

    const preferredAgentName = preferences.defaults.defaultAgent;
    return await resolveAgentByName(preferredAgentName, autoInstall);
}

/**
 * Update default agent preference
 * @param agentName The agent name to set as the new default
 * @throws {RegistryError} If the agent is not found in installed or bundled registry
 */
export async function updateDefaultAgentPreference(agentName: string): Promise<void> {
    // Validate agent exists in bundled or installed registry
    const agentsDir = getDextoGlobalPath('agents');
    const installedRegistryPath = path.join(agentsDir, 'registry.json');
    const bundledRegistryPath = resolveBundledScript('agents/agent-registry.json');

    // Check both registries
    const registriesToCheck = [
        { path: installedRegistryPath, name: 'installed' },
        { path: bundledRegistryPath, name: 'bundled' },
    ];

    for (const registry of registriesToCheck) {
        try {
            const manager = new AgentManager(registry.path);
            await manager.loadRegistry();
            if (manager.hasAgent(agentName)) {
                const { updateGlobalPreferences } = await import('./preferences/loader.js');
                await updateGlobalPreferences({
                    defaults: { defaultAgent: agentName },
                });
                logger.info(`Updated default agent preference to: ${agentName}`);
                return;
            }
        } catch (error) {
            logger.debug(`Agent '${agentName}' not found in ${registry.name} registry: ${error}`);
        }
    }

    // Agent not found in either registry
    throw RegistryError.agentNotFound(agentName, []);
}
