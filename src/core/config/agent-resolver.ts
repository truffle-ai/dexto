// src/core/config/agent-resolver.ts

import { promises as fs } from 'fs';
import path from 'path';
import { isPath } from '@core/utils/path.js';
import { getDextoProjectRoot } from '@core/utils/execution-context.js';
import { loadGlobalPreferences, globalPreferencesExist } from '@core/preferences/loader.js';
import { getExecutionContext } from '@core/utils/execution-context.js';
import { logger } from '@core/logger/index.js';
import { ConfigError } from './errors.js';

/**
 * Resolve agent path with preference integration
 * @param nameOrPath Optional agent name or explicit path
 * @returns Resolved absolute path to agent config
 * @throws DextoRuntimeError for any resolution failures
 */
export async function resolveAgentPath(nameOrPath?: string): Promise<string> {
    // 1. Handle explicit paths (highest priority)
    if (nameOrPath && isPath(nameOrPath)) {
        const resolved = path.resolve(nameOrPath);
        // Verify file exists - fail fast if not
        try {
            await fs.access(resolved);
            return resolved;
        } catch {
            throw ConfigError.fileNotFound(resolved);
        }
    }

    // 2. Handle registry names
    if (nameOrPath) {
        const { getAgentRegistry } = await import('@core/agent-registry/registry.js');
        const registry = getAgentRegistry();
        return await registry.resolveAgent(nameOrPath); // Let registry throw its own errors
    }

    // 3. Default agent resolution based on execution context
    return await resolveDefaultAgentByContext();
}

/**
 * Resolve default agent based on execution context - no fallbacks, fail fast
 */
async function resolveDefaultAgentByContext(): Promise<string> {
    const executionContext = getExecutionContext();

    switch (executionContext) {
        case 'dexto-source':
            return await resolveDefaultAgentForDextoSource();

        case 'dexto-project':
            return await resolveDefaultAgentForDextoProject();

        case 'global-cli':
            return await resolveDefaultAgentForGlobalCLI();

        default:
            throw ConfigError.unknownContext(executionContext);
    }
}

/**
 * Resolution for Dexto source code context - bundled default only, no fallbacks
 */
async function resolveDefaultAgentForDextoSource(): Promise<string> {
    const bundledPath = path.resolve('agents/default-agent.yml');

    try {
        await fs.access(bundledPath);
        return bundledPath;
    } catch {
        throw ConfigError.bundledNotFound(bundledPath);
    }
}

/**
 * Resolution for Dexto project context - project default OR preferences default, no fallbacks
 */
async function resolveDefaultAgentForDextoProject(): Promise<string> {
    const projectRoot = getDextoProjectRoot()!;

    // 1. Try project-local default-agent.yml first
    // TODO: Expand this to have project level configurable defaults/settings as well
    const projectDefaultPath = path.join(projectRoot, 'default-agent.yml');
    try {
        await fs.access(projectDefaultPath);
        return projectDefaultPath;
    } catch {
        logger.debug(`No project-local default-agent.yml found in ${projectRoot}`);
    }

    // 2. Use preferences default agent name - REQUIRED if no project default
    if (!globalPreferencesExist()) {
        throw ConfigError.noProjectDefault(projectDefaultPath);
    }

    const preferences = await loadGlobalPreferences();

    if (!preferences.setup.completed) {
        throw ConfigError.setupIncomplete();
    }

    const preferredAgentName = preferences.defaults.defaultAgent;
    const { getAgentRegistry } = await import('@core/agent-registry/registry.js');
    const registry = getAgentRegistry();
    return await registry.resolveAgent(preferredAgentName); // Let registry handle its own errors
}

/**
 * Resolution for Global CLI context - preferences default REQUIRED, no fallbacks
 */
async function resolveDefaultAgentForGlobalCLI(): Promise<string> {
    if (!globalPreferencesExist()) {
        throw ConfigError.noGlobalPreferences();
    }

    const preferences = await loadGlobalPreferences();

    if (!preferences.setup.completed) {
        throw ConfigError.setupIncomplete();
    }

    const preferredAgentName = preferences.defaults.defaultAgent;
    const { getAgentRegistry } = await import('@core/agent-registry/registry.js');
    const registry = getAgentRegistry();
    return await registry.resolveAgent(preferredAgentName); // Let registry handle its own errors
}

/**
 * Update default agent preference
 */
export async function updateDefaultAgentPreference(agentName: string): Promise<void> {
    // Validate agent exists first
    const { getAgentRegistry } = await import('@core/agent-registry/registry.js');
    const registry = getAgentRegistry();
    await registry.resolveAgent(agentName); // Will throw if not found

    // Update preferences
    const { updateGlobalPreferences } = await import('@core/preferences/loader.js');
    await updateGlobalPreferences({
        defaults: { defaultAgent: agentName },
    });

    logger.info(`Updated default agent preference to: ${agentName}`);
}
