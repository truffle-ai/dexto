import chalk from 'chalk';
import type { DextoAgent } from '@dexto/core';
import type { StyledOutput, SendMessageMarker } from '../../ink-cli/services/CommandService.js';

export interface CommandResult {
    type: 'command' | 'prompt';
    command?: string;
    args?: string[];
    rawInput: string;
}

/**
 * Command handler return type:
 * - boolean: Command handled (true) or not found (false)
 * - string: Output text to display
 * - StyledOutput: Styled output with structured data for rich rendering
 * - SendMessageMarker: Send text through normal streaming flow (for prompt commands)
 */
export type CommandHandlerResult = boolean | string | StyledOutput | SendMessageMarker;

/**
 * Context passed to command handlers
 */
export interface CommandContext {
    /** Current session ID, or null if no active session */
    sessionId: string | null;
}

export interface CommandDefinition {
    name: string;
    description: string;
    usage: string;
    category?: string;
    aliases?: string[];
    subcommands?: CommandDefinition[];
    handler: (
        args: string[],
        agent: DextoAgent,
        ctx: CommandContext
    ) => Promise<CommandHandlerResult>;
}

/**
 * Parse arguments respecting quotes and escape sequences
 */
function parseQuotedArguments(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let i = 0;

    while (i < input.length) {
        const char = input[i];
        const nextChar = input[i + 1];

        if (!inQuotes && (char === '"' || char === "'")) {
            inQuotes = true;
            quoteChar = char;
        } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            quoteChar = '';
        } else if (!inQuotes && char === ' ') {
            if (current) {
                args.push(current);
                current = '';
            }
        } else if (char === '\\' && nextChar) {
            // Handle escape sequences
            current += nextChar;
            i++; // Skip next character
        } else {
            current += char;
        }
        i++;
    }

    if (current) {
        args.push(current);
    }

    return args.filter((arg) => arg.length > 0);
}

/**
 * Parses user input to determine if it's a slash command, shell command, or regular prompt
 */
export function parseInput(input: string): CommandResult {
    const trimmed = input.trim();

    // Check if it's a shell command (! prefix)
    if (trimmed.startsWith('!')) {
        const shellCommand = trimmed.slice(1).trim();
        return {
            type: 'command',
            command: 'shell',
            args: [shellCommand],
            rawInput: trimmed,
        };
    }

    // Check if it's a slash command
    if (trimmed.startsWith('/')) {
        const args = parseQuotedArguments(trimmed.slice(1));
        const command = args[0] || '';
        const commandArgs = args.slice(1);

        return {
            type: 'command',
            command,
            args: commandArgs,
            rawInput: trimmed,
        };
    }

    // Regular user prompt
    return {
        type: 'prompt',
        rawInput: input,
    };
}

/**
 * Finds command suggestions based on partial input
 */
export function getCommandSuggestions(partial: string, commands: CommandDefinition[]): string[] {
    const suggestions: string[] = [];

    for (const cmd of commands) {
        // Check main command name
        if (cmd.name.startsWith(partial)) {
            suggestions.push(cmd.name);
        }

        // Check aliases
        if (cmd.aliases) {
            for (const alias of cmd.aliases) {
                if (alias.startsWith(partial)) {
                    suggestions.push(alias);
                }
            }
        }
    }

    return suggestions.sort();
}

/**
 * Formats help text for a command
 */
export function formatCommandHelp(cmd: CommandDefinition, detailed: boolean = false): string {
    let help = chalk.cyan(`/${cmd.name}`) + ' - ' + cmd.description;

    if (detailed) {
        help += '\n' + chalk.gray(`Usage: ${cmd.usage}`);

        if (cmd.aliases && cmd.aliases.length > 0) {
            help += '\n' + chalk.gray(`Aliases: ${cmd.aliases.map((a) => `/${a}`).join(', ')}`);
        }

        if (cmd.subcommands && cmd.subcommands.length > 0) {
            help += '\n' + chalk.gray('Subcommands:');
            for (const sub of cmd.subcommands) {
                help += '\n  ' + chalk.cyan(`/${cmd.name} ${sub.name}`) + ' - ' + sub.description;
            }
        }
    }

    return help;
}

/**
 * Displays a formatted list of all available commands
 */
export function displayAllCommands(commands: CommandDefinition[]): void {
    console.log(chalk.bold.green('\n📋 Available Commands:\n'));

    // Define category order for consistent display
    const categoryOrder = [
        'General',
        'Session Management',
        'Model Management',
        'MCP Management',
        'Plugin Management',
        'Tool Management',
        'Prompt Management',
        'System',
    ];

    const categories: { [key: string]: CommandDefinition[] } = {};

    // Initialize categories
    for (const category of categoryOrder) {
        categories[category] = [];
    }

    // Categorize commands using metadata
    for (const cmd of commands) {
        const category = cmd.category || 'General';
        if (!categories[category]) {
            categories[category] = [];
        }
        categories[category]!.push(cmd);
    }

    // Display by category in order
    for (const category of categoryOrder) {
        const cmds = categories[category];
        if (cmds && cmds.length > 0) {
            console.log(chalk.bold.rgb(255, 165, 0)(`${category}:`));
            for (const cmd of cmds) {
                console.log('  ' + formatCommandHelp(cmd));
            }
            console.log();
        }
    }

    // Display any uncategorized commands (fallback)
    for (const [category, cmds] of Object.entries(categories)) {
        if (!categoryOrder.includes(category) && cmds.length > 0) {
            console.log(chalk.bold.rgb(255, 165, 0)(`${category}:`));
            for (const cmd of cmds) {
                console.log('  ' + formatCommandHelp(cmd));
            }
            console.log();
        }
    }

    console.log(chalk.gray('💡 Tip: Use /help <command> for detailed help on any command'));
    console.log(chalk.gray('💡 Tip: Type your message normally (without /) to chat with the AI\n'));
}
