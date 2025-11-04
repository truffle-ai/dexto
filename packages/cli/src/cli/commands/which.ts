// packages/cli/src/cli/commands/which.ts

import chalk from 'chalk';
import { z } from 'zod';
import { resolveAgentPath, getAgentRegistry } from '@dexto/agent-management';

// Zod schema for which command validation
const WhichCommandSchema = z
    .object({
        agentName: z.string().min(1, 'Agent name cannot be empty'),
    })
    .strict();

export type WhichCommandOptions = z.output<typeof WhichCommandSchema>;

/**
 * Handle the which command
 */
export async function handleWhichCommand(agentName: string): Promise<void> {
    // Validate command with Zod
    const validated = WhichCommandSchema.parse({ agentName });
    const registry = getAgentRegistry();
    const availableAgents = Object.keys(registry.getAvailableAgents());

    try {
        const resolvedPath = await resolveAgentPath(validated.agentName, false, false); // Don't auto-install, don't inject preferences
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
