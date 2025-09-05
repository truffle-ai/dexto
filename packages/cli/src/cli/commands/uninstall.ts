// packages/cli/src/cli/commands/uninstall.ts

import { z } from 'zod';
import { getAgentRegistry } from '@dexto/core';

// Zod schema for uninstall command validation
const UninstallCommandSchema = z
    .object({
        agents: z.array(z.string().min(1, 'Agent name cannot be empty')),
        all: z.boolean().default(false),
        force: z.boolean().default(false),
    })
    .strict();

export type UninstallCommandOptions = z.output<typeof UninstallCommandSchema>;

/**
 * Validate uninstall command arguments
 */
async function validateUninstallCommand(
    agents: string[],
    options: Partial<UninstallCommandOptions>
): Promise<UninstallCommandOptions> {
    // Basic structure validation
    const validated = UninstallCommandSchema.parse({
        ...options,
        agents,
    });

    // Business logic validation
    const registry = getAgentRegistry();
    const installedAgents = await registry.getInstalledAgents();

    if (installedAgents.length === 0) {
        throw new Error('No agents are currently installed.');
    }

    if (!validated.all && validated.agents.length === 0) {
        throw new Error(
            `No agents specified. Use agent names or --all flag. Installed agents: ${installedAgents.join(', ')}`
        );
    }

    return validated;
}

export async function handleUninstallCommand(
    agents: string[],
    options: Partial<UninstallCommandOptions>
): Promise<void> {
    // Validate command with Zod
    const validated = await validateUninstallCommand(agents, options);
    const registry = getAgentRegistry();
    const installedAgents = await registry.getInstalledAgents();

    if (installedAgents.length === 0) {
        console.log('📋 No agents are currently installed.');
        return;
    }

    // Determine which agents to uninstall
    let agentsToUninstall: string[];
    if (validated.all) {
        agentsToUninstall = installedAgents;
        console.log(`📋 Uninstalling all ${agentsToUninstall.length} installed agents...`);
    } else {
        agentsToUninstall = validated.agents;

        // Validate all specified agents are actually installed
        const notInstalled = agentsToUninstall.filter((agent) => !installedAgents.includes(agent));
        if (notInstalled.length > 0) {
            throw new Error(
                `Agents not installed: ${notInstalled.join(', ')}. ` +
                    `Installed agents: ${installedAgents.join(', ')}`
            );
        }
    }

    console.log(`🗑️  Uninstalling ${agentsToUninstall.length} agents...`);

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Uninstall each agent
    for (const agentName of agentsToUninstall) {
        try {
            console.log(`\n🗑️  Uninstalling ${agentName}...`);
            await registry.uninstallAgent(agentName, validated.force);
            successCount++;
            console.log(`✅ ${agentName} uninstalled successfully`);
        } catch (error) {
            errorCount++;
            const errorMsg = `Failed to uninstall ${agentName}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            console.error(`❌ ${errorMsg}`);
        }
    }

    // For single agent operations, throw error if it failed
    if (agentsToUninstall.length === 1) {
        if (errorCount > 0) {
            throw new Error(errors[0]);
        }
        return;
    }

    // Show summary if more than 1 agent uninstalled
    console.log(`\n📊 Uninstallation Summary:`);
    console.log(`✅ Successfully uninstalled: ${successCount}`);
    if (errorCount > 0) {
        console.log(`❌ Failed to uninstall: ${errorCount}`);
        errors.forEach((error) => console.log(`   • ${error}`));
    }

    if (errorCount > 0 && successCount === 0) {
        throw new Error('All uninstallations failed');
    } else if (errorCount > 0) {
        console.log(`⚠️  Some uninstallations failed, but ${successCount} succeeded.`);
    } else {
        console.log(`🎉 All agents uninstalled successfully!`);
    }
}
