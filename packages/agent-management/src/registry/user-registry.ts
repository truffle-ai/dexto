import { promises as fs, readFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { getDextoGlobalPath } from '@dexto/core';
import {
    Registry,
    RegistrySchema,
    AgentRegistryEntry,
    normalizeRegistryJson,
    deriveDisplayName,
} from './types.js';
import { RegistryError } from './errors.js';
import { logger } from '@dexto/core';

const USER_REGISTRY_FILENAME = 'user-agent-registry.json';

/**
 * Get path to user registry file
 */
export function getUserRegistryPath(): string {
    return getDextoGlobalPath('', USER_REGISTRY_FILENAME);
}

/**
 * Load user registry from ~/.dexto/user-agent-registry.json
 * Returns empty registry if file doesn't exist
 */
export function loadUserRegistry(): Registry {
    const registryPath = getUserRegistryPath();

    if (!existsSync(registryPath)) {
        logger.debug('User registry not found, returning empty registry');
        return { version: '1.0.0', agents: {} };
    }

    try {
        const content = readFileSync(registryPath, 'utf-8');
        const data = JSON.parse(content);
        return RegistrySchema.parse(normalizeRegistryJson(data));
    } catch (error) {
        throw RegistryError.registryParseError(
            registryPath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Save user registry atomically using temp file + rename
 */
export async function saveUserRegistry(registry: Registry): Promise<void> {
    const registryPath = getUserRegistryPath();
    const tempPath = `${registryPath}.tmp.${Date.now()}`;
    const dextoDir = path.dirname(registryPath);

    try {
        // Ensure ~/.dexto directory exists
        await fs.mkdir(dextoDir, { recursive: true });

        // Write to temp file
        await fs.writeFile(tempPath, JSON.stringify(registry, null, 2), {
            encoding: 'utf-8',
            mode: 0o600,
        });

        // Atomic rename
        await fs.rename(tempPath, registryPath);

        logger.debug(`Saved user registry to ${registryPath}`);
    } catch (error) {
        // Clean up temp file on failure
        try {
            if (existsSync(tempPath)) {
                await fs.rm(tempPath, { force: true });
            }
        } catch {
            // Ignore cleanup errors
        }

        throw RegistryError.registryWriteError(
            registryPath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Merge bundled and user registries
 * User registry only contains custom agents
 * Name conflicts are not allowed (validated before adding to user registry)
 */
export function mergeRegistries(bundled: Registry, user: Registry): Registry {
    return {
        version: bundled.version,
        agents: {
            ...bundled.agents,
            ...user.agents,
        },
    };
}

/**
 * Check if agent exists in user registry
 */
export function userRegistryHasAgent(agentId: string): boolean {
    const userRegistry = loadUserRegistry();
    return agentId in userRegistry.agents;
}

/**
 * Add custom agent to user registry
 * Validates that name doesn't conflict with bundled registry
 */
export async function addAgentToUserRegistry(
    agentId: string,
    entry: Omit<AgentRegistryEntry, 'type'>
): Promise<void> {
    const userRegistry = loadUserRegistry();

    // Check if already exists in user registry
    if (agentId in userRegistry.agents) {
        throw RegistryError.agentAlreadyExists(agentId);
    }

    // Add with type: 'custom', enforcing invariants
    userRegistry.agents[agentId] = {
        ...entry,
        id: agentId, // Force consistency between key and id field
        name: entry.name && entry.name.trim().length > 0 ? entry.name : deriveDisplayName(agentId), // Ensure name is never undefined or whitespace-only
        type: 'custom',
    };

    await saveUserRegistry(userRegistry);
    logger.info(`Added custom agent '${agentId}' to user registry`);
}

/**
 * Remove custom agent from user registry
 */
export async function removeAgentFromUserRegistry(agentId: string): Promise<void> {
    const userRegistry = loadUserRegistry();

    if (!(agentId in userRegistry.agents)) {
        throw RegistryError.agentNotFound(agentId, Object.keys(userRegistry.agents));
    }

    delete userRegistry.agents[agentId];

    await saveUserRegistry(userRegistry);
    logger.info(`Removed custom agent '${agentId}' from user registry`);
}
