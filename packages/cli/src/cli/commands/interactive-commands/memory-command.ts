import chalk from 'chalk';
import * as path from 'path';
import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition, CommandHandlerResult, CommandContext } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import { addMemoryEntry, listMemoryEntries, removeMemoryEntry } from './memory-utils.js';
import { discoverAgentInstructionFile } from '@dexto/agent-management';

/**
 * Handler for /memory list (shows both project and global)
 */
async function handleListCommand(): Promise<string> {
    const { project, global } = listMemoryEntries();
    const lines: string[] = [];

    lines.push(chalk.bold('\n📝 Memory Entries:\n'));

    // Global Section
    lines.push(chalk.bold.magenta('Global Memory:'));
    if (global.filePath) {
        lines.push(chalk.dim(`  Path: ${global.filePath}`));
    }
    if (global.entries.length === 0) {
        lines.push(chalk.dim('  (No entries yet)'));
    } else {
        global.entries.forEach((entry, index) => {
            lines.push(chalk.cyan(`  ${index + 1}. `) + entry);
        });
    }
    lines.push('');

    // Project Section
    lines.push(chalk.bold.cyan('Project Memory:'));
    if (project.filePath) {
        lines.push(chalk.dim(`  Path: ${project.filePath}`));
    }
    if (project.entries.length === 0) {
        lines.push(chalk.dim('  (No entries yet)'));
    } else {
        project.entries.forEach((entry, index) => {
            lines.push(chalk.cyan(`  ${index + 1}. `) + entry);
        });
    }

    lines.push(chalk.dim('\nRemove with: /memory remove <number> (Project only via command)'));
    lines.push(chalk.dim('Use interactive /memory menu for more options'));

    return formatForInkCli(lines.join('\n'));
}

/**
 * Handler for /memory remove <index> (Project scope only for now via CLI args)
 */
async function handleRemoveCommand(args: string[]): Promise<string> {
    if (args.length === 0 || !args[0]) {
        return formatForInkCli(
            chalk.yellow('\n⚠ Please specify entry number to remove\n') +
                chalk.dim('Usage: /memory remove <number>\n') +
                chalk.dim('Use /memory list to see all entries')
        );
    }

    const index = parseInt(args[0], 10) - 1; // Convert to 0-based index

    if (isNaN(index)) {
        return formatForInkCli(chalk.red('\n❌ Invalid entry number'));
    }

    const result = removeMemoryEntry(index, 'project');

    if (result.success) {
        return formatForInkCli(
            chalk.green('\n✓ Memory entry removed') + chalk.dim(`\nFile: ${result.filePath}`)
        );
    } else {
        return formatForInkCli(chalk.red(`\n❌ Failed to remove entry: ${result.error}`));
    }
}

/**
 * Handler for # <content> - DEPRECATED: Now handled via /memory add
 * This remains for internal use if needed but prefix # is removed from parser.
 */
export async function handleMemoryAdd(
    content: string,
    scope: 'project' | 'global' = 'project'
): Promise<string> {
    if (!content || content.trim() === '') {
        return formatForInkCli(chalk.yellow('\n⚠ No content provided'));
    }

    const result = addMemoryEntry(content, scope);

    if (result.success) {
        return formatForInkCli(
            chalk.green(`\n✓ ${scope === 'global' ? 'Global' : 'Project'} memory entry added`) +
                chalk.dim(`\nFile: ${result.filePath}\n`) +
                chalk.dim('View all entries with: /memory list')
        );
    } else {
        return formatForInkCli(chalk.red(`\n❌ Failed to add memory: ${result.error}`));
    }
}

export const memoryCommand: CommandDefinition = {
    name: 'memory',
    description: 'Manage agent memory (interactive menu)',
    usage: '/memory [list|show|add|remove <number>]',
    category: 'General',
    aliases: ['mem'],
    handler: async (
        args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const subcommand = args[0]?.toLowerCase();

        // Handle subcommands
        if (subcommand === 'list' || subcommand === 'show') {
            return handleListCommand();
        }

        if (subcommand === 'remove' || subcommand === 'rm') {
            return handleRemoveCommand(args.slice(1));
        }

        if (subcommand === 'add') {
            // If argument is provided, we can jump straight to scope selection (handled by wizard)
            // But for now, just trigger the overlay which handles everything
            return {
                __triggerOverlay: 'memory-add-wizard',
                args: args.slice(1),
            } as any;
        }

        // Default: trigger interactive MemoryManager overlay
        return {
            __triggerOverlay: 'memory-manager',
        } as any;
    },
};
