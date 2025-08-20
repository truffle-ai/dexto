// src/app/cli/commands/install.ts

import { existsSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import { getAgentRegistry } from '@core/agent/registry/registry.js';
import { getDextoGlobalPath } from '@core/utils/path.js';

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
    if (!validated.all && validated.agents.length === 0) {
        throw new Error(
            'No agents specified. Use agent names or --all flag. Run dexto list-agents to see available agents.'
        );
    }

    if (!validated.all) {
        // Validate all specified agents exist in registry
        const invalidAgents = validated.agents.filter((agent) => !registry.hasAgent(agent));
        if (invalidAgents.length > 0) {
            const available = Object.keys(registry.getAvailableAgents());
            throw new Error(
                `Unknown agents: ${invalidAgents.join(', ')}. ` +
                    `Available agents: ${available.join(', ')}`
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
                continue;
            }

            await registry.resolveAgent(agentName, validated.injectPreferences);
            successCount++;
            console.log(`✅ ${agentName} installed successfully`);
        } catch (error) {
            errorCount++;
            const errorMsg = `Failed to install ${agentName}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            console.error(`❌ ${errorMsg}`);
        }
    }

    // Summary
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
