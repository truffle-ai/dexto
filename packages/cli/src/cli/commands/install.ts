// packages/cli/src/cli/commands/install.ts

import { existsSync, statSync, readFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import * as p from '@clack/prompts';
import { getDextoGlobalPath, resolveBundledScript } from '@dexto/agent-management';
import { installBundledAgent, installCustomAgent } from '../../utils/agent-helpers.js';
import { capture } from '../../analytics/index.js';

// Zod schema for install command validation
const InstallCommandSchema = z
    .object({
        agents: z.array(z.string().min(1, 'Agent name cannot be empty')),
        all: z.boolean().default(false),
        injectPreferences: z.boolean().default(true),
        force: z.boolean().default(false),
    })
    .strict();

export type InstallCommandOptions = z.output<typeof InstallCommandSchema>;

/**
 * Load bundled agent registry for validation
 */
function loadBundledRegistry(): Record<string, any> {
    try {
        const registryPath = resolveBundledScript('agents/agent-registry.json');
        const content = readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        return registry.agents || {};
    } catch (error) {
        throw new Error(
            `Failed to load bundled registry: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Check if a string is a file path (contains path separators or ends with .yml)
 */
function isFilePath(input: string): boolean {
    return (
        input.includes('/') ||
        input.includes('\\') ||
        input.endsWith('.yml') ||
        input.endsWith('.yaml')
    );
}

/**
 * Extract agent name from file path and sanitize for validity
 * Agent names must be lowercase alphanumeric with hyphens only.
 * Examples:
 *   './my-agent.yml' -> 'my-agent'
 *   './my_agent.yml' -> 'my-agent' (underscore converted)
 *   './agents/foo/agent.yml' -> 'agent'
 *   './MyAgent.yml' -> 'myagent'
 */
function extractAgentNameFromPath(filePath: string): string {
    const basename = path.basename(filePath);

    // If it's a file, remove the extension
    let name = basename;
    if (basename.endsWith('.yml') || basename.endsWith('.yaml')) {
        name = basename.replace(/\.(yml|yaml)$/, '');
    }

    // Sanitize: lowercase, replace underscores and invalid chars with hyphens
    name = name
        .toLowerCase()
        .replace(/[_\s]+/g, '-') // Replace underscores and spaces with hyphens
        .replace(/[^a-z0-9-]/g, '') // Remove any other invalid characters
        .replace(/-+/g, '-') // Collapse multiple hyphens
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    return name;
}

/**
 * Prompt user for custom agent metadata
 */
async function promptForMetadata(suggestedName: string): Promise<{
    agentName: string;
    description: string;
    author: string;
    tags: string[];
}> {
    p.intro('📝 Custom Agent Installation');

    const agentName = (await p.text({
        message: 'Agent name:',
        placeholder: suggestedName,
        defaultValue: suggestedName,
        validate: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Agent name is required';
            }
            if (!/^[a-z0-9-]+$/.test(value)) {
                return 'Agent name must contain only lowercase letters, numbers, and hyphens';
            }
            return undefined;
        },
    })) as string;

    if (p.isCancel(agentName)) {
        p.cancel('Installation cancelled');
        process.exit(0);
    }

    const description = (await p.text({
        message: 'Description:',
        placeholder: 'A custom agent for...',
        validate: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Description is required';
            }
            return undefined;
        },
    })) as string;

    if (p.isCancel(description)) {
        p.cancel('Installation cancelled');
        process.exit(0);
    }

    const author = (await p.text({
        message: 'Author:',
        placeholder: 'Your Name',
        validate: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Author is required';
            }
            return undefined;
        },
    })) as string;

    if (p.isCancel(author)) {
        p.cancel('Installation cancelled');
        process.exit(0);
    }

    const tagsInput = (await p.text({
        message: 'Tags (comma-separated):',
        placeholder: 'custom, coding, productivity',
        defaultValue: 'custom',
    })) as string;

    if (p.isCancel(tagsInput)) {
        p.cancel('Installation cancelled');
        process.exit(0);
    }

    const tags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

    // Ask about main config file for directory-based agents
    // We'll determine if it's a directory later in the flow

    return { agentName, description, author, tags };
}

/**
 * Validate install command arguments with registry-aware validation
 */
function validateInstallCommand(
    agents: string[],
    options: Partial<InstallCommandOptions>
): InstallCommandOptions {
    // Basic structure validation
    const validated = InstallCommandSchema.parse({
        ...options,
        agents,
    });

    // Business logic validation
    const availableAgents = loadBundledRegistry();
    if (!validated.all && validated.agents.length === 0) {
        throw new Error(
            `No agents specified. Use agent names or --all flag.  Available agents: ${Object.keys(availableAgents).join(', ')}`
        );
    }

    if (!validated.all) {
        // Separate file paths from registry names
        const filePaths = validated.agents.filter(isFilePath);
        const registryNames = validated.agents.filter((agent) => !isFilePath(agent));

        // Validate registry names exist in registry
        const invalidAgents = registryNames.filter((agent) => !(agent in availableAgents));
        if (invalidAgents.length > 0) {
            throw new Error(
                `Unknown agents: ${invalidAgents.join(', ')}. ` +
                    `Available agents: ${Object.keys(availableAgents).join(', ')}`
            );
        }

        // Validate file paths exist
        for (const filePath of filePaths) {
            const resolved = path.resolve(filePath);
            if (!existsSync(resolved)) {
                throw new Error(`File not found: ${filePath}`);
            }
        }
    }

    return validated;
}

// TODO: move registry code into CLI and move dexto_install_agent metric into registry
export async function handleInstallCommand(
    agents: string[],
    options: Partial<InstallCommandOptions>
): Promise<void> {
    // Validate command with Zod
    const validated = validateInstallCommand(agents, options);

    // Determine which agents to install
    let agentsToInstall: string[];
    if (validated.all) {
        // --all flag only works with registry agents, not file paths
        const availableAgents = loadBundledRegistry();
        agentsToInstall = Object.keys(availableAgents);
        console.log(`📋 Installing all ${agentsToInstall.length} available agents...`);
    } else {
        agentsToInstall = validated.agents;
    }

    console.log(`🚀 Installing ${agentsToInstall.length} agents...`);

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const installed: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    // Install each agent
    for (const agentInput of agentsToInstall) {
        try {
            // Check if this is a file path or registry name
            if (isFilePath(agentInput)) {
                // Custom agent installation from file path
                console.log(`\n📦 Installing custom agent from ${agentInput}...`);

                const resolvedPath = path.resolve(agentInput);

                // Detect if source is directory or file
                const stats = statSync(resolvedPath);
                const isDirectory = stats.isDirectory();

                // Extract suggested name based on whether it's a directory or file
                const suggestedName = isDirectory
                    ? path.basename(resolvedPath)
                    : extractAgentNameFromPath(resolvedPath);

                // Prompt for metadata
                const metadata = await promptForMetadata(suggestedName);

                // Note: For directory-based agents, the new installation API
                // expects the main config file to be named 'agent.yml' by convention

                // Check if already installed (unless --force)
                const globalAgentsDir = getDextoGlobalPath('agents');
                const installedPath = path.join(globalAgentsDir, metadata.agentName);
                if (existsSync(installedPath) && !validated.force) {
                    console.log(
                        `⏭️  ${metadata.agentName} already installed (use --force to reinstall)`
                    );
                    skipped.push(metadata.agentName);
                    capture('dexto_install_agent', {
                        agent: metadata.agentName,
                        status: 'skipped',
                        reason: 'already_installed',
                        force: validated.force,
                        injectPreferences: validated.injectPreferences,
                    });
                    continue;
                }

                // Install custom agent
                await installCustomAgent(
                    metadata.agentName,
                    resolvedPath,
                    {
                        name: metadata.agentName,
                        description: metadata.description,
                        author: metadata.author,
                        tags: metadata.tags,
                    },
                    {
                        injectPreferences: validated.injectPreferences,
                    }
                );

                successCount++;
                console.log(`✅ ${metadata.agentName} installed successfully`);
                installed.push(metadata.agentName);

                p.outro('🎉 Custom agent installed successfully!');

                capture('dexto_install_agent', {
                    agent: metadata.agentName,
                    status: 'installed',
                    force: validated.force,
                    injectPreferences: validated.injectPreferences,
                });
            } else {
                // Bundled agent installation from registry
                console.log(`\n📦 Installing ${agentInput}...`);

                // Check if already installed (unless --force)
                const globalAgentsDir = getDextoGlobalPath('agents');
                const installedPath = path.join(globalAgentsDir, agentInput);
                if (existsSync(installedPath) && !validated.force) {
                    console.log(`⏭️  ${agentInput} already installed (use --force to reinstall)`);
                    skipped.push(agentInput);
                    capture('dexto_install_agent', {
                        agent: agentInput,
                        status: 'skipped',
                        reason: 'already_installed',
                        force: validated.force,
                        injectPreferences: validated.injectPreferences,
                    });
                    continue;
                }

                await installBundledAgent(agentInput, {
                    injectPreferences: validated.injectPreferences,
                });
                successCount++;
                console.log(`✅ ${agentInput} installed successfully`);
                installed.push(agentInput);

                capture('dexto_install_agent', {
                    agent: agentInput,
                    status: 'installed',
                    force: validated.force,
                    injectPreferences: validated.injectPreferences,
                });
            }
        } catch (error) {
            errorCount++;
            const errorMsg = `Failed to install ${agentInput}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            failed.push(agentInput);
            console.error(`❌ ${errorMsg}`);

            // Sanitize agent identifier for analytics (avoid sending full local paths)
            const safeAgentId = isFilePath(agentInput) ? path.basename(agentInput) : agentInput;
            capture('dexto_install_agent', {
                agent: safeAgentId,
                status: 'failed',
                error_message: error instanceof Error ? error.message : String(error),
                force: validated.force,
                injectPreferences: validated.injectPreferences,
            });
        }
    }

    // Emit analytics for both single- and multi-agent cases
    try {
        capture('dexto_install', {
            requested: agentsToInstall,
            installed,
            skipped,
            failed,
            successCount,
            errorCount,
        });
    } catch {
        // Analytics failures should not block CLI execution.
    }

    // For single agent operations, throw error if it failed (after emitting analytics)
    if (agentsToInstall.length === 1) {
        if (errorCount > 0) {
            throw new Error(errors[0]);
        }
        return;
    }

    // Show summary if more than 1 agent installed
    console.log(`\n📊 Installation Summary:`);
    console.log(`✅ Successfully installed: ${successCount}`);
    if (errorCount > 0) {
        console.log(`❌ Failed to install: ${errorCount}`);
        errors.forEach((error) => console.log(`   • ${error}`));
    }

    if (errorCount > 0 && successCount === 0) {
        throw new Error('All installations failed');
    } else if (errorCount > 0) {
        console.log(`⚠️  Some installations failed, but ${successCount} succeeded.`);
    } else {
        console.log(`🎉 All agents installed successfully!`);
    }
}
