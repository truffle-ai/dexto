/**
 * Prompt Commands Module
 *
 * This module defines prompt management slash commands for the Dexto CLI interface.
 * These commands provide functionality for viewing and managing system prompts.
 *
 * Available Prompt Commands:
 * - /prompt - Display the current system prompt
 */

import chalk from 'chalk';
import { logger } from '@core/index.js';
import type { DextoAgent } from '@core/index.js';
import type { CommandDefinition } from './command-parser.js';

/**
 * Prompt management commands
 */
export const promptCommands: CommandDefinition[] = [
    {
        name: 'prompt',
        description: 'Display the current system prompt',
        usage: '/prompt',
        category: 'Prompt Management',
        handler: async (args: string[], agent: DextoAgent): Promise<boolean> => {
            try {
                const systemPrompt = await agent.getSystemPrompt();

                console.log(chalk.bold.green('\n📋 Current System Prompt:\n'));
                console.log(chalk.dim('─'.repeat(80)));
                console.log(systemPrompt);
                console.log(chalk.dim('─'.repeat(80)));
                console.log();
            } catch (error) {
                logger.error(
                    `Failed to get system prompt: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            return true;
        },
    },
];
