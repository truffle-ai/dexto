// packages/cli/src/cli/utils/bundled-agent-sync.ts

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { realpathSync } from 'fs';
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';
import {
    getDextoGlobalPath,
    resolveBundledScript,
    copyDirectory,
    loadBundledRegistryAgents,
    type AgentRegistryEntry,
} from '@dexto/agent-management';

/**
 * Agent sync status
 */
type AgentStatus = 'up_to_date' | 'changes_available' | 'not_installed' | 'error';

export interface BundledSyncTarget {
    agentId: string;
    agentEntry: AgentRegistryEntry;
}

function normalizeComparablePath(filePath: string): string {
    try {
        return realpathSync(filePath);
    } catch {
        return path.resolve(filePath);
    }
}

function getInstalledMainConfigPath(
    agentId: string,
    agentEntry: AgentRegistryEntry
): string | null {
    const installedRoot = path.join(getDextoGlobalPath('agents'), agentId);

    if (agentEntry.source.endsWith('/')) {
        if (!agentEntry.main) {
            return null;
        }
        return path.join(installedRoot, agentEntry.main);
    }

    return path.join(installedRoot, path.basename(agentEntry.source));
}

export function getBundledSyncTargetForAgentPath(agentPath: string): BundledSyncTarget | null {
    try {
        const normalizedAgentPath = normalizeComparablePath(agentPath);
        const bundledAgents = loadBundledRegistryAgents();

        for (const [agentId, agentEntry] of Object.entries(bundledAgents)) {
            const installedMainConfigPath = getInstalledMainConfigPath(agentId, agentEntry);
            if (!installedMainConfigPath) {
                continue;
            }

            if (normalizeComparablePath(installedMainConfigPath) === normalizedAgentPath) {
                return { agentId, agentEntry };
            }
        }

        return null;
    } catch (error) {
        logger.debug(
            `Failed to resolve sync target for agent path '${agentPath}': ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

/**
 * Calculate SHA256 hash of a file
 */
async function hashFile(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Calculate combined hash for a directory
 * Hashes all files recursively and combines them
 */
async function hashDirectory(dirPath: string): Promise<string> {
    const hash = createHash('sha256');
    const files: string[] = [];

    async function collectFiles(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await collectFiles(fullPath);
            } else {
                files.push(fullPath);
            }
        }
    }

    await collectFiles(dirPath);

    // Sort for consistent ordering
    files.sort();

    for (const file of files) {
        const relativePath = path.relative(dirPath, file);
        const content = await fs.readFile(file);
        hash.update(relativePath);
        hash.update(content);
    }

    return hash.digest('hex');
}

/**
 * Get hash of bundled agent
 */
async function getBundledAgentHash(agentEntry: AgentRegistryEntry): Promise<string | null> {
    try {
        const sourcePath = resolveBundledScript(`agents/${agentEntry.source}`);
        const stat = await fs.stat(sourcePath);

        if (stat.isDirectory()) {
            return await hashDirectory(sourcePath);
        } else {
            return await hashFile(sourcePath);
        }
    } catch (error) {
        logger.debug(
            `Failed to hash bundled agent: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

/**
 * Get hash of installed agent
 */
async function getInstalledAgentHash(
    agentId: string,
    agentEntry?: AgentRegistryEntry
): Promise<string | null> {
    try {
        const installedPath = path.join(getDextoGlobalPath('agents'), agentId);
        const stat = await fs.stat(installedPath);

        // Single-file bundled agents are installed inside an agent directory.
        // Hash the installed YAML file so bundled vs installed comparisons stay symmetric.
        if (agentEntry && !agentEntry.source.endsWith('/')) {
            if (!stat.isDirectory()) {
                return await hashFile(installedPath);
            }
            const installedFile = path.join(installedPath, path.basename(agentEntry.source));
            return await hashFile(installedFile);
        }

        if (stat.isDirectory()) {
            return await hashDirectory(installedPath);
        } else {
            return await hashFile(installedPath);
        }
    } catch (error) {
        logger.debug(
            `Failed to hash installed agent: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

/**
 * Check if an agent is installed
 */
async function isAgentInstalled(agentId: string): Promise<boolean> {
    try {
        const installedPath = path.join(getDextoGlobalPath('agents'), agentId);
        await fs.access(installedPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get list of all installed agent directories
 */
async function getInstalledAgentIds(): Promise<string[]> {
    try {
        const agentsDir = getDextoGlobalPath('agents');
        const entries = await fs.readdir(agentsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
        logger.debug(
            `Failed to list installed agents: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

/**
 * Get agent status by comparing bundled vs installed
 */
async function getAgentStatus(
    agentId: string,
    agentEntry: AgentRegistryEntry
): Promise<AgentStatus> {
    if (!(await isAgentInstalled(agentId))) return 'not_installed';

    try {
        const bundledHash = await getBundledAgentHash(agentEntry);
        const installedHash = await getInstalledAgentHash(agentId, agentEntry);
        if (!bundledHash || !installedHash) return 'error';
        return bundledHash === installedHash ? 'up_to_date' : 'changes_available';
    } catch {
        return 'error';
    }
}

/**
 * Quick check if any installed agents have updates available
 *
 * Used at CLI startup to prompt for sync without full command output.
 * Returns true if at least one installed agent differs from bundled.
 *
 * @returns true if should prompt for sync
 */
export async function shouldPromptForSync(agentPath?: string): Promise<boolean> {
    try {
        const bundledAgents = loadBundledRegistryAgents();

        if (agentPath) {
            const syncTarget = getBundledSyncTargetForAgentPath(agentPath);
            if (!syncTarget) {
                return false;
            }

            const bundledHash = await getBundledAgentHash(syncTarget.agentEntry);
            const installedHash = await getInstalledAgentHash(
                syncTarget.agentId,
                syncTarget.agentEntry
            );

            return Boolean(bundledHash && installedHash && bundledHash !== installedHash);
        }

        const installedAgentIds = await getInstalledAgentIds();

        for (const agentId of installedAgentIds) {
            const agentEntry = bundledAgents[agentId];
            // Skip custom agents (not in bundled registry)
            if (!agentEntry) continue;

            const bundledHash = await getBundledAgentHash(agentEntry);
            const installedHash = await getInstalledAgentHash(agentId, agentEntry);

            if (bundledHash && installedHash && bundledHash !== installedHash) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.debug(
            `shouldPromptForSync check failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}

/**
 * Update an agent from bundled to installed
 */
async function updateAgent(agentId: string, agentEntry: AgentRegistryEntry): Promise<void> {
    const agentsDir = getDextoGlobalPath('agents');
    const targetDir = path.join(agentsDir, agentId);
    const sourcePath = resolveBundledScript(`agents/${agentEntry.source}`);

    // Ensure agents directory exists
    await fs.mkdir(agentsDir, { recursive: true });

    // Remove old installation
    try {
        await fs.rm(targetDir, { recursive: true, force: true });
    } catch {
        // Ignore if doesn't exist
    }

    // Copy from bundled source
    const stat = await fs.stat(sourcePath);

    if (stat.isDirectory()) {
        await copyDirectory(sourcePath, targetDir);
    } else {
        await fs.mkdir(targetDir, { recursive: true });
        const targetFile = path.join(targetDir, path.basename(sourcePath));
        await fs.copyFile(sourcePath, targetFile);
    }
}

/**
 * Replaces the installed copy of a bundled agent with the one this CLI ships, when they differ.
 * A failed update is reported and startup carries on with the installed copy.
 */
export async function syncBundledAgent(agentId: string): Promise<void> {
    const entry = loadBundledRegistryAgents()[agentId];
    if (!entry) throw new Error(`'${agentId}' is not a bundled agent`);
    if ((await getAgentStatus(agentId, entry)) !== 'changes_available') {
        p.log.success(`${agentId} is up to date`);
        return;
    }
    try {
        await updateAgent(agentId, entry);
        p.log.success(`Updated: ${agentId}`);
    } catch (error) {
        p.log.warn(`Failed to update: ${agentId}`);
        logger.debug(
            `Failed to update ${agentId}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
