// packages/cli/src/cli/commands/list-agents.ts

import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { z } from 'zod';
import {
    getDextoGlobalPath,
    globalPreferencesExist,
    loadGlobalPreferences,
    loadBundledRegistryAgents,
} from '@dexto/agent-management';

// Zod schema for list-agents command validation
const ListAgentsCommandSchema = z
    .object({
        verbose: z.boolean().default(false),
        installed: z.boolean().default(false),
        available: z.boolean().default(false),
    })
    .strict();

export type ListAgentsCommandOptions = z.output<typeof ListAgentsCommandSchema>;
export type ListAgentsCommandOptionsInput = z.input<typeof ListAgentsCommandSchema>;

/**
 * Information about an installed agent
 */
interface InstalledAgentInfo {
    name: string;
    description: string;
    path: string;
    llmProvider?: string;
    llmModel?: string;
    installedAt?: Date;
}

/**
 * Information about an available agent from registry
 */
interface AvailableAgentInfo {
    name: string;
    description: string;
    author: string;
    tags: string[];
    type: 'builtin' | 'custom';
}

/**
 * Get information about installed agents
 */
async function getInstalledAgents(): Promise<InstalledAgentInfo[]> {
    const globalAgentsDir = getDextoGlobalPath('agents');

    if (!existsSync(globalAgentsDir)) {
        return [];
    }

    const bundledRegistry = loadBundledRegistryAgents();
    const installedAgents: InstalledAgentInfo[] = [];

    try {
        const entries = await fs.readdir(globalAgentsDir, { withFileTypes: true });

        for (const entry of entries) {
            // Skip registry.json and temp files
            if (entry.name === 'registry.json' || entry.name.includes('.tmp.')) {
                continue;
            }

            if (entry.isDirectory()) {
                const agentName = entry.name;
                const agentPath = path.join(globalAgentsDir, entry.name);

                try {
                    // For directory agents, try to find main config
                    // Check bundled registry for main field, default to agent.yml
                    const bundledEntry = bundledRegistry[agentName];
                    const mainFile = bundledEntry?.main || 'agent.yml';
                    const mainConfigPath = path.join(agentPath, mainFile);

                    // If main config doesn't exist, skip
                    if (!existsSync(mainConfigPath)) {
                        console.warn(
                            `Warning: Could not find main config for agent '${agentName}' at ${mainConfigPath}`
                        );
                        continue;
                    }

                    // Get install date from directory stats
                    const stats = await fs.stat(agentPath);

                    // Try to extract LLM info from config
                    let llmProvider: string | undefined;
                    let llmModel: string | undefined;

                    try {
                        const configContent = await fs.readFile(mainConfigPath, 'utf-8');
                        const configMatch = configContent.match(/provider:\s*([^\n\r]+)/);
                        const modelMatch = configContent.match(/model:\s*([^\n\r]+)/);

                        llmProvider = configMatch?.[1]?.trim();
                        llmModel = modelMatch?.[1]?.trim();
                    } catch (_error) {
                        // Ignore config parsing errors
                    }

                    // Get description from bundled registry if available
                    const description = bundledEntry?.description || 'Custom agent';

                    const agentInfo: InstalledAgentInfo = {
                        name: agentName,
                        description,
                        path: mainConfigPath,
                        installedAt: stats.birthtime || stats.mtime,
                    };

                    if (llmProvider) agentInfo.llmProvider = llmProvider;
                    if (llmModel) agentInfo.llmModel = llmModel;

                    installedAgents.push(agentInfo);
                } catch (error) {
                    // Skip agents that can't be processed
                    console.warn(`Warning: Could not process agent '${agentName}': ${error}`);
                }
            }
        }
    } catch (_error) {
        // Return empty array if we can't read the directory
        return [];
    }

    return installedAgents.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get information about available agents from registry
 */
function getAvailableAgents(): AvailableAgentInfo[] {
    const bundledRegistry = loadBundledRegistryAgents();

    return Object.entries(bundledRegistry)
        .map(([name, data]) => ({
            name,
            description: data.description || 'No description',
            author: data.author || 'Unknown',
            tags: data.tags || [],
            type: 'builtin' as const,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Handle the list-agents command
 */
export async function handleListAgentsCommand(
    options: ListAgentsCommandOptionsInput
): Promise<void> {
    // Validate command with Zod
    const validated = ListAgentsCommandSchema.parse(options);

    console.log(chalk.cyan('\n📋 Dexto Agents\n'));

    // Get global preferences for LLM info
    let globalLLM: string | undefined;
    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            globalLLM = `${preferences.llm.provider}/${preferences.llm.model}`;
        } catch {
            // Ignore preference loading errors
        }
    }

    // Get installed and available agents
    const installedAgents = await getInstalledAgents();
    const availableAgents = getAvailableAgents();

    // Filter based on options
    const showInstalled = !validated.available || validated.installed;
    const showAvailable = !validated.installed || validated.available;

    // Show installed agents
    if (showInstalled && installedAgents.length > 0) {
        console.log(chalk.green('✅ Installed Agents:'));

        for (const agent of installedAgents) {
            const llmInfo =
                agent.llmProvider && agent.llmModel
                    ? `${agent.llmProvider}/${agent.llmModel}`
                    : globalLLM || 'Unknown LLM';

            const llmDisplay = chalk.gray(`(${llmInfo})`);

            if (validated.verbose) {
                console.log(`  ${chalk.bold(agent.name)} ${llmDisplay}`);
                console.log(`    ${chalk.gray(agent.description)}`);
                console.log(`    ${chalk.gray('Path:')} ${agent.path}`);
                if (agent.installedAt) {
                    console.log(
                        `    ${chalk.gray('Installed:')} ${agent.installedAt.toLocaleDateString()}`
                    );
                }
                console.log();
            } else {
                console.log(`  • ${chalk.bold(agent.name)} ${llmDisplay} - ${agent.description}`);
            }
        }
        console.log();
    } else if (showInstalled) {
        console.log(chalk.rgb(255, 165, 0)('📦 No agents installed yet.'));
        console.log(
            chalk.gray('   Use `dexto install <agent-name>` to install agents from the registry.\n')
        );
    }

    // Show available agents (not installed)
    if (showAvailable) {
        const availableNotInstalled = availableAgents.filter(
            (available) => !installedAgents.some((installed) => installed.name === available.name)
        );

        const builtinAgents = availableNotInstalled.filter((a) => a.type === 'builtin');
        const customAgents = availableNotInstalled.filter((a) => a.type === 'custom');

        if (builtinAgents.length > 0) {
            console.log(chalk.blue('📋 Builtin Agents Available to Install:'));

            for (const agent of builtinAgents) {
                if (validated.verbose) {
                    console.log(`  ${chalk.bold(agent.name)}`);
                    console.log(`    ${chalk.gray(agent.description)}`);
                    console.log(`    ${chalk.gray('Author:')} ${agent.author}`);
                    console.log(`    ${chalk.gray('Tags:')} ${agent.tags.join(', ')}`);
                    console.log();
                } else {
                    console.log(`  • ${chalk.bold(agent.name)} - ${agent.description}`);
                }
            }
            console.log();
        }

        if (customAgents.length > 0) {
            console.log(chalk.cyan('🔧 Custom Agents Available:'));

            for (const agent of customAgents) {
                if (validated.verbose) {
                    console.log(`  ${chalk.bold(agent.name)}`);
                    console.log(`    ${chalk.gray(agent.description)}`);
                    console.log(`    ${chalk.gray('Author:')} ${agent.author}`);
                    console.log(`    ${chalk.gray('Tags:')} ${agent.tags.join(', ')}`);
                    console.log();
                } else {
                    console.log(`  • ${chalk.bold(agent.name)} - ${agent.description}`);
                }
            }
            console.log();
        }
    }

    // Show summary
    const totalInstalled = installedAgents.length;
    const availableToInstall = availableAgents.filter(
        (a) => !installedAgents.some((i) => i.name === a.name)
    ).length;

    if (!validated.verbose) {
        console.log(
            chalk.gray(
                `📊 Summary: ${totalInstalled} installed, ${availableToInstall} available to install`
            )
        );

        if (availableToInstall > 0) {
            console.log(
                chalk.gray(`   Use \`dexto install <agent-name>\` to install more agents.`)
            );
        }

        console.log(chalk.gray(`   Use \`dexto list-agents --verbose\` for detailed information.`));
        console.log(
            chalk.gray(`   After installing an agent, use \`dexto -a <agent-name>\` to run it.`)
        );
    }

    console.log();
}
