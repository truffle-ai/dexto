import chalk from 'chalk';
import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition, CommandHandlerResult, CommandContext } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import { addMemoryEntry, listMemoryEntries, removeMemoryEntry } from './memory-utils.js';

/**
 * Handler for /memory show (shows both project and global)
 */
async function handleShowCommand(): Promise<string> {
    const { project, global } = listMemoryEntries();
    const lines: string[] = [];

    lines.push(chalk.bold('\n📝 Memory Entries:\n'));

    // Global Section
    lines.push(chalk.bold.magenta('User Memory (Global):'));
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

    lines.push(chalk.dim('\nQuick remove:'));
    lines.push(chalk.dim('  /memory remove <number>          # Remove from project'));
    lines.push(chalk.dim('  /memory remove <number> --global # Remove from global'));
    lines.push(chalk.dim('  /memory remove global <number>   # Remove from global'));
    lines.push(chalk.dim('\nOr use: /memory remove (interactive wizard)'));

    return formatForInkCli(lines.join('\n'));
}

/**
 * Handler for /memory remove with power user shortcuts
 * Syntax:
 *   /memory remove                      → Interactive wizard
 *   /memory remove <number>             → Remove from project
 *   /memory remove <number> --global    → Remove from global
 *   /memory remove global <number>      → Remove from global
 */
async function handleRemoveCommand(args: string[]): Promise<CommandHandlerResult> {
    // No args → trigger wizard
    if (args.length === 0) {
        return {
            __triggerOverlay: 'memory-remove-wizard',
        } as any;
    }

    // Parse arguments
    let scope: 'project' | 'global' = 'project';
    let indexStr: string | undefined;

    // Check for "global" as first arg: /memory remove global 3
    if (args[0] === 'global') {
        scope = 'global';
        indexStr = args[1];
    } else {
        indexStr = args[0];
        // Check for --global flag: /memory remove 3 --global
        if (args.includes('--global')) {
            scope = 'global';
        }
    }

    // Validate index
    if (!indexStr) {
        return formatForInkCli(chalk.red('\n❌ Missing entry number'));
    }

    const index = parseInt(indexStr, 10) - 1; // Convert to 0-based index

    if (isNaN(index)) {
        return formatForInkCli(chalk.red('\n❌ Invalid entry number'));
    }

    // Remove the entry
    const result = removeMemoryEntry(index, scope);

    if (result.success) {
        const scopeLabel = scope === 'global' ? 'User (global)' : 'Project';
        return formatForInkCli(
            chalk.green(`\n✓ ${scopeLabel} memory entry removed`) +
                chalk.dim(`\nFile: ${result.filePath}`)
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
                chalk.dim('View all entries with: /memory show')
        );
    } else {
        return formatForInkCli(chalk.red(`\n❌ Failed to add memory: ${result.error}`));
    }
}

export const memoryCommand: CommandDefinition = {
    name: 'memory',
    description: 'Manage agent memory (interactive menu)',
    usage: '/memory [show|add|remove [<number>] [--global]]',
    category: 'General',
    aliases: ['mem'],
    handler: async (
        args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const subcommand = args[0]?.toLowerCase();

        // Handle subcommands
        if (subcommand === 'show') {
            return handleShowCommand();
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
