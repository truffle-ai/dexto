import chalk from 'chalk';
import * as path from 'path';
import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition, CommandHandlerResult, CommandContext } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import { addMemoryEntry, listMemoryEntries, removeMemoryEntry } from './memory-utils.js';
import { discoverAgentInstructionFile } from '@dexto/agent-management';

/**
 * Handler for /memory list
 */
async function handleListCommand(): Promise<string> {
    const { entries, filePath } = listMemoryEntries();
    const lines: string[] = [];

    lines.push(chalk.bold('\n📝 Memory Entries:\n'));

    if (entries.length === 0) {
        lines.push(chalk.yellow('No memory entries found'));
        lines.push(chalk.dim('\nAdd entries with: # <content>'));
        lines.push(chalk.dim("Example: # Don't commit changes without user request"));
    } else {
        entries.forEach((entry, index) => {
            lines.push(chalk.cyan(`${index + 1}. `) + entry);
        });
        lines.push(chalk.dim(`\nFile: ${filePath}`));
        lines.push(chalk.dim('Remove entries with: /memory remove <number>'));
    }

    return formatForInkCli(lines.join('\n'));
}

/**
 * Handler for /memory remove <index>
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

    const result = removeMemoryEntry(index);

    if (result.success) {
        return formatForInkCli(
            chalk.green('\n✓ Memory entry removed') + chalk.dim(`\nFile: ${result.filePath}`)
        );
    } else {
        return formatForInkCli(chalk.red(`\n❌ Failed to remove entry: ${result.error}`));
    }
}

/**
 * Handler for # <content> (memory add)
 */
export async function handleMemoryAdd(content: string): Promise<string> {
    if (!content || content.trim() === '') {
        return formatForInkCli(
            chalk.yellow('\n⚠ No content provided\n') +
                chalk.dim('Usage: # <content>\n') +
                chalk.dim("Example: # Don't commit changes without user request")
        );
    }

    const result = addMemoryEntry(content);

    if (result.success) {
        return formatForInkCli(
            chalk.green('\n✓ Memory entry added') +
                chalk.dim(`\nFile: ${result.filePath}\n`) +
                chalk.dim('View all entries with: /memory list')
        );
    } else {
        return formatForInkCli(chalk.red(`\n❌ Failed to add memory: ${result.error}`));
    }
}

export const memoryCommand: CommandDefinition = {
    name: 'memory',
    description: 'Manage agent memory (show, list, remove entries)',
    usage: '/memory [list|remove <number>]',
    category: 'General',
    aliases: ['mem'],
    handler: async (
        args: string[],
        agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const subcommand = args[0]?.toLowerCase();

        // Handle subcommands
        if (subcommand === 'list') {
            return handleListCommand();
        }

        if (subcommand === 'remove' || subcommand === 'rm') {
            return handleRemoveCommand(args.slice(1));
        }

        // Default: show current memory file
        const lines: string[] = [];

        lines.push(chalk.bold('\n📝 Agent Memory File:\n'));

        const projectMemoryFile = discoverAgentInstructionFile();

        if (projectMemoryFile) {
            const relPath = './' + path.basename(projectMemoryFile);
            lines.push(chalk.green(`✓ Loaded: ${relPath}`));
            lines.push(chalk.dim(`  Full path: ${projectMemoryFile}`));
        } else {
            lines.push(chalk.yellow(`✗ No memory file found in current directory`));
            lines.push(chalk.dim(`  Looking for: AGENTS.md, CLAUDE.md, or GEMINI.md`));
            lines.push(chalk.dim(`  Will be created when you add first memory entry`));
        }

        lines.push(chalk.dim('\nCommands:'));
        lines.push(chalk.dim('  # <content>          - Add memory entry'));
        lines.push(chalk.dim('  /memory list         - List all entries'));
        lines.push(chalk.dim('  /memory remove <num> - Remove entry'));

        return formatForInkCli(lines.join('\n'));
    },
};
