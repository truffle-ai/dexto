// packages/cli/src/cli/commands/which.ts

import { readFileSync } from 'fs';
import chalk from 'chalk';
import { z } from 'zod';
import { resolveAgentPath, resolveBundledScript } from '@dexto/agent-management';

// Zod schema for which command validation
const WhichCommandSchema = z
    .object({
        agentName: z.string().min(1, 'Agent name cannot be empty'),
    })
    .strict();

export type WhichCommandOptions = z.output<typeof WhichCommandSchema>;

/**
 * Load available agent names from bundled registry
 */
function getAvailableAgentNames(): string[] {
    try {
        const registryPath = resolveBundledScript('agents/agent-registry.json');
        const content = readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        return Object.keys(registry.agents || {});
    } catch (_error) {
        return [];
    }
}

/**
 * Handle the which command
 */
export async function handleWhichCommand(agentName: string): Promise<void> {
    // Validate command with Zod
    const validated = WhichCommandSchema.parse({ agentName });
    const availableAgents = getAvailableAgentNames();

    try {
        const resolvedPath = await resolveAgentPath(validated.agentName, false); // Don't auto-install
        console.log(resolvedPath);
    } catch (error) {
        console.error(
            chalk.red(
                `❌ dexto which command failed: ${error instanceof Error ? error.message : String(error)}. Available agents: ${availableAgents.join(', ')}`
            )
        );
        process.exit(1);
    }
}
