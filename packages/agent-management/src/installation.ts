import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@dexto/core';
import { getDextoGlobalPath, resolveBundledScript, copyDirectory } from './utils/path.js';
import { loadGlobalPreferences } from './preferences/loader.js';
import { writePreferencesToAgent } from './writer.js';
import type { AgentMetadata } from './AgentManager.js';

export interface InstallOptions {
    /** Directory where agents are stored (default: ~/.dexto/agents) */
    agentsDir?: string;
    /** Whether to inject global preferences into agent config (default: true) */
    injectPreferences?: boolean;
}

/**
 * Get the default agents directory
 */
function getAgentsDir(options?: InstallOptions): string {
    return options?.agentsDir ?? getDextoGlobalPath('agents');
}

/**
 * Get the user registry path for installed agents
 */
function getUserRegistryPath(agentsDir: string): string {
    return path.join(agentsDir, 'registry.json');
}

/**
 * Load user registry (creates empty if doesn't exist)
 */
async function loadUserRegistry(registryPath: string): Promise<{ agents: any[] }> {
    try {
        const content = await fs.readFile(registryPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { agents: [] };
        }
        throw error;
    }
}

/**
 * Save user registry
 */
async function saveUserRegistry(registryPath: string, registry: { agents: any[] }): Promise<void> {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Install agent from bundled registry to local directory
 *
 * @param agentId ID of the agent to install from bundled registry
 * @param options Installation options
 * @returns Path to the installed agent's main config file
 *
 * @throws {Error} If agent not found in bundled registry or installation fails
 *
 * @example
 * ```typescript
 * await installBundledAgent('coding-agent');
 * console.log('Agent installed to ~/.dexto/agents/coding-agent');
 * ```
 */
export async function installBundledAgent(
    agentId: string,
    options?: InstallOptions
): Promise<string> {
    const agentsDir = getAgentsDir(options);
    const bundledRegistryPath = resolveBundledScript('agents/agent-registry.json');

    logger.info(`Installing agent: ${agentId}`);

    // Load bundled registry
    let bundledRegistry: any;
    try {
        const content = await fs.readFile(bundledRegistryPath, 'utf-8');
        bundledRegistry = JSON.parse(content);
    } catch (error) {
        throw new Error(
            `Failed to load bundled registry: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    const agentEntry = bundledRegistry.agents[agentId];

    if (!agentEntry) {
        const available = Object.keys(bundledRegistry.agents);
        throw new Error(
            `Agent '${agentId}' not found in bundled registry. Available: ${available.join(', ')}`
        );
    }

    const targetDir = path.join(agentsDir, agentId);

    // Check if already installed
    try {
        await fs.access(targetDir);
        logger.info(`Agent '${agentId}' already installed`);

        // Return path to main config
        const mainFile = agentEntry.main || `${agentId}.yml`;
        return path.join(targetDir, mainFile);
    } catch {
        // Not installed, continue
    }

    // Ensure agents directory exists
    await fs.mkdir(agentsDir, { recursive: true });

    // Copy from bundled source
    const sourcePath = resolveBundledScript(`agents/${agentEntry.source}`);
    const tempDir = `${targetDir}.tmp.${Date.now()}`;

    try {
        if (agentEntry.source.endsWith('/')) {
            // Directory agent - copy entire directory
            await copyDirectory(sourcePath, tempDir);
        } else {
            // Single file agent - create directory and copy file
            await fs.mkdir(tempDir, { recursive: true });
            const targetFile = path.join(tempDir, path.basename(sourcePath));
            await fs.copyFile(sourcePath, targetFile);
        }

        // Atomic rename
        await fs.rename(tempDir, targetDir);

        logger.info(`✓ Installed agent '${agentId}' to ${targetDir}`);

        // Inject preferences if requested
        if (options?.injectPreferences !== false) {
            try {
                const preferences = await loadGlobalPreferences();
                await writePreferencesToAgent(targetDir, preferences);
                logger.info(`✓ Applied global preferences to '${agentId}'`);
            } catch (error) {
                logger.warn(
                    `Failed to inject preferences: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // Add to user registry
        const userRegistryPath = getUserRegistryPath(agentsDir);
        const userRegistry = await loadUserRegistry(userRegistryPath);

        if (!userRegistry.agents.some((a: any) => a.id === agentId)) {
            const mainFile = agentEntry.main || path.basename(agentEntry.source);
            userRegistry.agents.push({
                id: agentId,
                name: agentEntry.name,
                description: agentEntry.description,
                configPath: `./${agentId}/${mainFile}`,
                author: agentEntry.author,
                tags: agentEntry.tags,
            });
            await saveUserRegistry(userRegistryPath, userRegistry);
        }

        return path.join(targetDir, agentEntry.main || path.basename(agentEntry.source));
    } catch (error) {
        // Clean up temp directory on failure
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }

        throw new Error(
            `Installation failed for '${agentId}': ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Install custom agent from local path
 *
 * @param agentId Unique ID for the custom agent
 * @param sourcePath Absolute path to agent YAML file or directory
 * @param metadata Agent metadata (name, description, author, tags)
 * @param options Installation options
 * @returns Path to the installed agent's main config file
 *
 * @throws {Error} If agent ID already exists or installation fails
 *
 * @example
 * ```typescript
 * await installCustomAgent('my-agent', '/path/to/agent.yml', {
 *   name: 'My Agent',
 *   description: 'Custom agent for my use case',
 *   author: 'John Doe',
 *   tags: ['custom']
 * });
 * ```
 */
export async function installCustomAgent(
    agentId: string,
    sourcePath: string,
    metadata: Pick<AgentMetadata, 'name' | 'description' | 'author' | 'tags'>,
    options?: InstallOptions
): Promise<string> {
    const agentsDir = getAgentsDir(options);
    const targetDir = path.join(agentsDir, agentId);

    logger.info(`Installing custom agent: ${agentId}`);

    // Validate custom agent ID doesn't conflict with bundled agents
    try {
        const bundledRegistryPath = resolveBundledScript('agents/agent-registry.json');
        const bundledContent = await fs.readFile(bundledRegistryPath, 'utf-8');
        const bundledRegistry = JSON.parse(bundledContent);

        if (agentId in bundledRegistry.agents) {
            throw new Error(
                `Custom agent name '${agentId}' conflicts with builtin agent. Choose a different ID.`
            );
        }
    } catch (error) {
        // If it's our conflict error, rethrow it
        if (error instanceof Error && error.message.includes('conflicts with builtin')) {
            throw error;
        }
        // Otherwise, bundled registry might not exist (testing scenario), continue
        logger.warn(
            `Could not validate against bundled registry: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // Check if already exists
    try {
        await fs.access(targetDir);
        throw new Error(`Agent '${agentId}' already exists`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
        // Doesn't exist, continue
    }

    // Validate source exists
    const resolvedSource = path.resolve(sourcePath);
    let stat;
    try {
        stat = await fs.stat(resolvedSource);
    } catch (error) {
        throw new Error(`Source path not found: ${resolvedSource}`);
    }

    // Ensure agents directory exists
    await fs.mkdir(agentsDir, { recursive: true });

    // Copy source to target
    try {
        if (stat.isDirectory()) {
            await copyDirectory(resolvedSource, targetDir);
        } else {
            await fs.mkdir(targetDir, { recursive: true });
            const filename = path.basename(resolvedSource);
            await fs.copyFile(resolvedSource, path.join(targetDir, filename));
        }

        logger.info(`✓ Installed custom agent '${agentId}' to ${targetDir}`);

        // Add to user registry
        const userRegistryPath = getUserRegistryPath(agentsDir);
        const userRegistry = await loadUserRegistry(userRegistryPath);

        const configFile = stat.isDirectory() ? 'agent.yml' : path.basename(resolvedSource);
        userRegistry.agents.push({
            id: agentId,
            name: metadata.name || agentId,
            description: metadata.description,
            configPath: `./${agentId}/${configFile}`,
            author: metadata.author,
            tags: metadata.tags || [],
        });

        await saveUserRegistry(userRegistryPath, userRegistry);

        return path.join(targetDir, configFile);
    } catch (error) {
        // Clean up on failure
        try {
            await fs.rm(targetDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }

        throw new Error(
            `Failed to install custom agent '${agentId}': ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Uninstall agent by removing it from disk and user registry
 *
 * @param agentId ID of the agent to uninstall
 * @param options Installation options
 *
 * @throws {Error} If agent not found or uninstallation fails
 *
 * @example
 * ```typescript
 * await uninstallAgent('my-custom-agent');
 * console.log('Agent uninstalled');
 * ```
 */
export async function uninstallAgent(agentId: string, options?: InstallOptions): Promise<void> {
    const agentsDir = getAgentsDir(options);
    const targetDir = path.join(agentsDir, agentId);

    logger.info(`Uninstalling agent: ${agentId}`);

    // Check if exists
    try {
        await fs.access(targetDir);
    } catch (error) {
        throw new Error(`Agent '${agentId}' is not installed`);
    }

    // Remove from disk
    await fs.rm(targetDir, { recursive: true, force: true });
    logger.info(`✓ Removed agent directory: ${targetDir}`);

    // Remove from user registry
    const userRegistryPath = getUserRegistryPath(agentsDir);
    try {
        const userRegistry = await loadUserRegistry(userRegistryPath);
        userRegistry.agents = userRegistry.agents.filter((a: any) => a.id !== agentId);
        await saveUserRegistry(userRegistryPath, userRegistry);
        logger.info(`✓ Removed '${agentId}' from user registry`);
    } catch (error) {
        logger.warn(
            `Failed to update user registry: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * List installed agents
 *
 * @param options Installation options
 * @returns Array of installed agent IDs
 *
 * @example
 * ```typescript
 * const installed = await listInstalledAgents();
 * console.log(installed); // ['coding-agent', 'my-custom-agent']
 * ```
 */
export async function listInstalledAgents(options?: InstallOptions): Promise<string[]> {
    const agentsDir = getAgentsDir(options);

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
