// packages/cli/src/cli/commands/sync-agents.ts

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import chalk from 'chalk';
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
 * Options for the sync-agents command
 */
export interface SyncAgentsCommandOptions {
    /** Just list status without updating */
    list?: boolean;
    /** Update all without prompting */
    force?: boolean;
}

/**
 * Agent sync status
 */
type AgentStatus =
    | 'up_to_date'
    | 'changes_available'
    | 'not_installed'
    | 'custom' // User-installed, not in bundled registry
    | 'error';

interface AgentInfo {
    id: string;
    name: string;
    description?: string | undefined;
    status: AgentStatus;
    error?: string | undefined;
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
async function getInstalledAgentHash(agentId: string): Promise<string | null> {
    try {
        const installedPath = path.join(getDextoGlobalPath('agents'), agentId);
        const stat = await fs.stat(installedPath);

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
async function getAgentStatus(agentId: string, agentEntry: AgentRegistryEntry): Promise<AgentInfo> {
    const installed = await isAgentInstalled(agentId);

    if (!installed) {
        return {
            id: agentId,
            name: agentEntry.name,
            description: agentEntry.description,
            status: 'not_installed',
        };
    }

    try {
        const bundledHash = await getBundledAgentHash(agentEntry);
        const installedHash = await getInstalledAgentHash(agentId);

        if (!bundledHash || !installedHash) {
            return {
                id: agentId,
                name: agentEntry.name,
                description: agentEntry.description,
                status: 'error',
                error: 'Could not compute hash',
            };
        }

        if (bundledHash === installedHash) {
            return {
                id: agentId,
                name: agentEntry.name,
                description: agentEntry.description,
                status: 'up_to_date',
            };
        } else {
            return {
                id: agentId,
                name: agentEntry.name,
                description: agentEntry.description,
                status: 'changes_available',
            };
        }
    } catch (error) {
        return {
            id: agentId,
            name: agentEntry.name,
            description: agentEntry.description,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// Store sync dismissed state in cache directory
const SYNC_DISMISSED_PATH = getDextoGlobalPath('cache', 'sync-dismissed.json');

/**
 * Check if sync was dismissed for current version
 */
async function wasSyncDismissed(currentVersion: string): Promise<boolean> {
    try {
        const content = await fs.readFile(SYNC_DISMISSED_PATH, 'utf-8');
        const data = JSON.parse(content) as { version: string };
        return data.version === currentVersion;
    } catch (error) {
        logger.debug(
            `Could not read sync dismissed state: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}

/**
 * Mark sync as dismissed for current version
 */
export async function markSyncDismissed(currentVersion: string): Promise<void> {
    try {
        await fs.mkdir(path.dirname(SYNC_DISMISSED_PATH), { recursive: true });
        await fs.writeFile(SYNC_DISMISSED_PATH, JSON.stringify({ version: currentVersion }));
    } catch (error) {
        logger.debug(
            `Could not save sync dismissed state: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Clear sync dismissed state (called after successful sync)
 */
export async function clearSyncDismissed(): Promise<void> {
    try {
        await fs.unlink(SYNC_DISMISSED_PATH);
    } catch (error) {
        // File might not exist - only log if it's a different error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.debug(
                `Could not clear sync dismissed state: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

/**
 * Quick check if any installed agents have updates available
 *
 * Used at CLI startup to prompt for sync without full command output.
 * Returns true if at least one installed agent differs from bundled
 * AND the user hasn't dismissed the prompt for this version.
 *
 * @param currentVersion Current CLI version to check dismissal state
 * @returns true if should prompt for sync
 */
export async function shouldPromptForSync(currentVersion: string): Promise<boolean> {
    try {
        // Check if user already dismissed for this version
        if (await wasSyncDismissed(currentVersion)) {
            return false;
        }

        const bundledAgents = loadBundledRegistryAgents();
        const installedAgentIds = await getInstalledAgentIds();

        for (const agentId of installedAgentIds) {
            const agentEntry = bundledAgents[agentId];
            // Skip custom agents (not in bundled registry)
            if (!agentEntry) continue;

            const bundledHash = await getBundledAgentHash(agentEntry);
            const installedHash = await getInstalledAgentHash(agentId);

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
 * Display agent status with appropriate colors
 */
function formatStatus(status: AgentStatus): string {
    switch (status) {
        case 'up_to_date':
            return chalk.green('Up to date');
        case 'changes_available':
            return chalk.yellow('Changes available');
        case 'not_installed':
            return chalk.gray('Not installed');
        case 'custom':
            return chalk.blue('Custom (user-installed)');
        case 'error':
            return chalk.red('Error');
        default:
            return chalk.gray('Unknown');
    }
}

/**
 * Main handler for the sync-agents command
 *
 * @param options Command options
 *
 * @example
 * ```bash
 * dexto sync-agents          # Interactive - prompt for each
 * dexto sync-agents --list   # Show what would be updated
 * dexto sync-agents --force  # Update all without prompting
 * ```
 */
export async function handleSyncAgentsCommand(options: SyncAgentsCommandOptions): Promise<void> {
    const { list = false, force = false } = options;

    p.intro(chalk.cyan('Agent Sync'));

    const spinner = p.spinner();
    spinner.start('Checking agent configs...');

    try {
        // Load bundled registry (uses existing function from agent-management)
        const bundledAgents = loadBundledRegistryAgents();
        const bundledAgentIds = Object.keys(bundledAgents);

        // Get installed agents
        const installedAgentIds = await getInstalledAgentIds();

        // Find custom agents (installed but not in bundled registry)
        const customAgentIds = installedAgentIds.filter((id) => !bundledAgents[id]);

        // Check status of all bundled agents
        const agentInfos: AgentInfo[] = [];

        for (const agentId of bundledAgentIds) {
            const entry = bundledAgents[agentId];
            if (entry) {
                const info = await getAgentStatus(agentId, entry);
                agentInfos.push(info);
            }
        }

        // Add custom agents
        for (const agentId of customAgentIds) {
            agentInfos.push({
                id: agentId,
                name: agentId,
                status: 'custom',
            });
        }

        spinner.stop('Agent check complete');

        // Display status
        console.log('');
        console.log(chalk.bold('Agent Status:'));
        console.log('');

        const updatableAgents = agentInfos.filter((a) => a.status === 'changes_available');
        const upToDateAgents = agentInfos.filter((a) => a.status === 'up_to_date');
        const notInstalledAgents = agentInfos.filter((a) => a.status === 'not_installed');
        const customAgents = agentInfos.filter((a) => a.status === 'custom');
        const errorAgents = agentInfos.filter((a) => a.status === 'error');

        // Show updatable first
        for (const agent of updatableAgents) {
            console.log(`  ${chalk.cyan(agent.id)}:`);
            console.log(`    Status: ${formatStatus(agent.status)}`);
            if (agent.description) {
                console.log(`    ${chalk.gray(agent.description)}`);
            }
            console.log('');
        }

        // Show up-to-date
        for (const agent of upToDateAgents) {
            console.log(`  ${chalk.green(agent.id)}: ${formatStatus(agent.status)}`);
        }

        // Show not installed (summarized)
        if (notInstalledAgents.length > 0) {
            console.log('');
            console.log(
                chalk.gray(
                    `  ${notInstalledAgents.length} agents not installed: ${notInstalledAgents.map((a) => a.id).join(', ')}`
                )
            );
        }

        // Show custom
        if (customAgents.length > 0) {
            console.log('');
            for (const agent of customAgents) {
                console.log(`  ${chalk.blue(agent.id)}: ${formatStatus(agent.status)}`);
            }
        }

        // Show errors
        for (const agent of errorAgents) {
            console.log(`  ${chalk.red(agent.id)}: ${formatStatus(agent.status)}`);
            if (agent.error) {
                console.log(`    ${chalk.red(agent.error)}`);
            }
        }

        console.log('');

        // Summary
        console.log(chalk.bold('Summary:'));
        console.log(`  Up to date: ${chalk.green(upToDateAgents.length.toString())}`);
        console.log(`  Changes available: ${chalk.yellow(updatableAgents.length.toString())}`);
        console.log(`  Not installed: ${chalk.gray(notInstalledAgents.length.toString())}`);
        if (customAgents.length > 0) {
            console.log(`  Custom: ${chalk.blue(customAgents.length.toString())}`);
        }
        console.log('');

        // If list mode, stop here
        if (list) {
            p.outro('Use `dexto sync-agents` to update agents');
            return;
        }

        // No updates needed
        if (updatableAgents.length === 0) {
            p.outro(chalk.green('All installed agents are up to date!'));
            return;
        }

        // Force mode - update all without prompting
        if (force) {
            const updateSpinner = p.spinner();
            updateSpinner.start(`Updating ${updatableAgents.length} agents...`);

            let successCount = 0;
            let failCount = 0;

            for (const agent of updatableAgents) {
                const entry = bundledAgents[agent.id];
                if (entry) {
                    try {
                        await updateAgent(agent.id, entry);
                        successCount++;
                    } catch (error) {
                        failCount++;
                        logger.error(
                            `Failed to update ${agent.id}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            }

            updateSpinner.stop(`Updated ${successCount} agents`);

            if (failCount > 0) {
                p.log.warn(`${failCount} agents failed to update`);
            }

            p.outro(chalk.green('Sync complete!'));
            return;
        }

        // Interactive mode - prompt for each
        for (const agent of updatableAgents) {
            const shouldUpdate = await p.confirm({
                message: `Update ${chalk.cyan(agent.name)} (${agent.id})?`,
                initialValue: true,
            });

            if (p.isCancel(shouldUpdate)) {
                p.cancel('Sync cancelled');
                return;
            }

            if (shouldUpdate) {
                const entry = bundledAgents[agent.id];
                if (entry) {
                    try {
                        const updateSpinner = p.spinner();
                        updateSpinner.start(`Updating ${agent.id}...`);
                        await updateAgent(agent.id, entry);
                        updateSpinner.stop(`Updated ${agent.id}`);
                    } catch (error) {
                        p.log.error(
                            `Failed to update ${agent.id}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            } else {
                p.log.info(`Skipped ${agent.id}`);
            }
        }

        p.outro(chalk.green('Sync complete!'));
    } catch (error) {
        spinner.stop('Error');
        p.log.error(
            `Failed to check agents: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}
