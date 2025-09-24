// packages/cli/src/cli/commands/install.ts

import { existsSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import { getAgentRegistry, getDextoGlobalPath } from '@dexto/core';
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
 * Validate install command arguments with registry-aware validation
 */
function validateInstallCommand(
    agents: string[],
    options: Partial<InstallCommandOptions>
): InstallCommandOptions {
    const registry = getAgentRegistry();

    // Basic structure validation
    const validated = InstallCommandSchema.parse({
        ...options,
        agents,
    });

    // Business logic validation
    const availableAgents = registry.getAvailableAgents();
    if (!validated.all && validated.agents.length === 0) {
        throw new Error(
            `No agents specified. Use agent names or --all flag.  Available agents: ${Object.keys(availableAgents).join(', ')}`
        );
    }

    if (!validated.all) {
        // Validate all specified agents exist in registry
        const invalidAgents = validated.agents.filter((agent) => !registry.hasAgent(agent));
        if (invalidAgents.length > 0) {
            throw new Error(
                `Unknown agents: ${invalidAgents.join(', ')}. ` +
                    `Available agents: ${Object.keys(availableAgents).join(', ')}`
            );
        }
    }

    return validated;
}

export async function handleInstallCommand(
    agents: string[],
    options: Partial<InstallCommandOptions>
): Promise<void> {
    // Validate command with Zod
    const validated = validateInstallCommand(agents, options);
    const registry = getAgentRegistry();

    // Determine which agents to install
    let agentsToInstall: string[];
    if (validated.all) {
        agentsToInstall = Object.keys(registry.getAvailableAgents());
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
    for (const agentName of agentsToInstall) {
        try {
            console.log(`\n📦 Installing ${agentName}...`);

            // Check if already installed (unless --force)
            const globalAgentsDir = getDextoGlobalPath('agents');
            const installedPath = path.join(globalAgentsDir, agentName);
            if (existsSync(installedPath) && !validated.force) {
                console.log(`⏭️  ${agentName} already installed (use --force to reinstall)`);
                successCount++;
                skipped.push(agentName);
                continue;
            }

            await registry.installAgent(agentName, validated.injectPreferences);
            successCount++;
            console.log(`✅ ${agentName} installed successfully`);
            installed.push(agentName);
        } catch (error) {
            errorCount++;
            const errorMsg = `Failed to install ${agentName}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            failed.push(agentName);
            console.error(`❌ ${errorMsg}`);
        }
    }

    // For single agent operations, throw error if it failed
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

    // Track analytics summary for install
    try {
        capture('dexto_install', {
            requested: agentsToInstall,
            installed,
            skipped,
            failed,
            successCount,
            errorCount,
        });
    } catch {}

    if (errorCount > 0 && successCount === 0) {
        throw new Error('All installations failed');
    } else if (errorCount > 0) {
        console.log(`⚠️  Some installations failed, but ${successCount} succeeded.`);
    } else {
        console.log(`🎉 All agents installed successfully!`);
    }
}
