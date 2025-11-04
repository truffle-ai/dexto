// packages/core/src/config/agent-resolver.ts

import { promises as fs } from 'fs';
import path from 'path';
import {
    isPath,
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
    logger,
} from '@dexto/core';
import { loadGlobalPreferences, globalPreferencesExist } from './preferences/loader.js';
import { ConfigError } from '@dexto/core';

/**
 * Resolve agent path with preference integration
 * @param nameOrPath Optional agent name or explicit path
 * @param autoInstall Whether to automatically install missing agents from registry (default: true)
 * @param injectPreferences Whether to inject preferences during auto-installation (default: true)
 * @returns Resolved absolute path to agent config
 * @throws DextoRuntimeError for any resolution failures
 */
export async function resolveAgentPath(
    nameOrPath?: string,
    autoInstall: boolean = true,
    injectPreferences: boolean = true
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

    // 2. Handle registry names
    if (nameOrPath) {
        const { getAgentRegistry } = await import('@core/agent/registry/registry.js');
        const registry = getAgentRegistry();
        return await registry.resolveAgent(nameOrPath, autoInstall, injectPreferences); // Let registry throw its own errors
    }

    // 3. Default agent resolution based on execution context
    return await resolveDefaultAgentByContext(autoInstall, injectPreferences);
}

/**
 * Resolve default agent based on execution context
 */
async function resolveDefaultAgentByContext(
    autoInstall: boolean = true,
    injectPreferences: boolean = true
): Promise<string> {
    const executionContext = getExecutionContext();

    switch (executionContext) {
        case 'dexto-source':
            return await resolveDefaultAgentForDextoSource(autoInstall, injectPreferences);

        case 'dexto-project':
            return await resolveDefaultAgentForDextoProject(autoInstall, injectPreferences);

        case 'global-cli':
            return await resolveDefaultAgentForGlobalCLI(autoInstall, injectPreferences);

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
async function resolveDefaultAgentForDextoSource(
    autoInstall: boolean = true,
    injectPreferences: boolean = true
): Promise<string> {
    logger.debug('Resolving default agent for dexto source context');
    const sourceRoot = findDextoSourceRoot();
    if (!sourceRoot) {
        throw ConfigError.bundledNotFound('dexto source directory not found');
    }
    const repoConfigPath = path.join(sourceRoot, 'agents', 'default-agent.yml');

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
                const { getAgentRegistry } = await import('@core/agent/registry/registry.js');
                const registry = getAgentRegistry();
                return await registry.resolveAgent(
                    preferredAgentName,
                    autoInstall,
                    injectPreferences
                );
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
async function resolveDefaultAgentForDextoProject(
    autoInstall: boolean = true,
    injectPreferences: boolean = true
): Promise<string> {
    // Get the dexto project root directory
    logger.debug('Resolving default agent for dexto project context');
    const projectRoot = findDextoProjectRoot();
    if (!projectRoot) {
        throw ConfigError.unknownContext('dexto-project: project root not found');
    }

    // 1. Try project-local default-agent.yml first
    // TODO: Expand this to have project level configurable defaults/settings as well.
    // Could set this in dexto.config.ts or something similar and read from there
    // This will allow users to configure default agent specific for a project
    // link this with create-app which creates this file and preferences module

    // Probe common project-local locations (ordered by preference)
    const candidatePaths = [
        path.join(projectRoot, 'default-agent.yml'),
        path.join(projectRoot, 'agents', 'default-agent.yml'),
        path.join(projectRoot, 'src', 'dexto', 'agents', 'default-agent.yml'),
    ];
    for (const p of candidatePaths) {
        try {
            await fs.access(p);
            return p;
        } catch {
            // continue
        }
    }
    logger.debug(`No project-local default-agent.yml found in ${projectRoot}`);

    // 2. Use preferences default agent name - REQUIRED if no project default
    if (!globalPreferencesExist()) {
        // Provide the project root to help the user fix placement
        throw ConfigError.noProjectDefault(projectRoot);
    }

    const preferences = await loadGlobalPreferences();

    if (!preferences.setup.completed) {
        throw ConfigError.setupIncomplete();
    }

    const preferredAgentName = preferences.defaults.defaultAgent;
    const { getAgentRegistry } = await import('@core/agent/registry/registry.js');
    const registry = getAgentRegistry();
    return await registry.resolveAgent(preferredAgentName, autoInstall, injectPreferences); // Let registry handle its own errors
}

/**
 * Resolution for Global CLI context - preferences default REQUIRED
 */
async function resolveDefaultAgentForGlobalCLI(
    autoInstall: boolean = true,
    injectPreferences: boolean = true
): Promise<string> {
    logger.debug('Resolving default agent for global CLI context');
    if (!globalPreferencesExist()) {
        throw ConfigError.noGlobalPreferences();
    }

    const preferences = await loadGlobalPreferences();

    if (!preferences.setup.completed) {
        throw ConfigError.setupIncomplete();
    }

    const preferredAgentName = preferences.defaults.defaultAgent;
    const { getAgentRegistry } = await import('@core/agent/registry/registry.js');
    const registry = getAgentRegistry();
    return await registry.resolveAgent(preferredAgentName, autoInstall, injectPreferences); // Let registry handle its own errors
}

/**
 * Update default agent preference
 */
export async function updateDefaultAgentPreference(agentName: string): Promise<void> {
    // Validate agent exists in registry first
    const { getAgentRegistry } = await import('@core/agent/registry/registry.js');
    const { RegistryError } = await import('@core/agent/registry/errors.js');
    const { isPath } = await import('@core/utils/path.js');
    const registry = getAgentRegistry();

    // Only registry agent names are allowed here, not file paths
    if (isPath(agentName) || !registry.hasAgent(agentName)) {
        const available = Object.keys(registry.getAvailableAgents());
        throw RegistryError.agentNotFound(agentName, available);
    }

    // Update preferences
    const { updateGlobalPreferences } = await import('@core/preferences/loader.js');
    await updateGlobalPreferences({
        defaults: { defaultAgent: agentName },
    });

    logger.info(`Updated default agent preference to: ${agentName}`);
}
