// `dexto [command…] --help --json`: what a command takes, and for the root the commands and the
// frozen exit codes, for agents.

import { EXIT_CODE_MEANINGS } from './failure.js';

import type { Command } from 'commander';

/** `dexto chat delete`: the words that name a command. */
export function commandPath(command: Command): string {
    return command.parent === null
        ? command.name()
        : `${commandPath(command.parent)} ${command.name()}`;
}

/**
 * The command `--help` (or `-h`) with `--json` asks about: the deepest one its words name. Null
 * without both flags, or for a command the cloud command engine answers, which has no Commander
 * help option and prints its own JSON help.
 */
export function jsonHelpCommand(program: Command, args: readonly string[]): Command | null {
    if (!args.includes('--json') || !(args.includes('--help') || args.includes('-h'))) return null;
    let command = program;
    for (const word of args) {
        if (word.startsWith('-')) continue;
        const next = command.commands.find(
            (each) => each.name() === word || each.aliases().includes(word)
        );
        if (next === undefined) break;
        command = next;
    }
    const hasHelpOption = command
        .createHelp()
        .visibleOptions(command)
        .some((option) => option.long === '--help');
    return hasHelpOption ? command : null;
}

export function helpJson(command: Command) {
    return command.parent === null ? rootHelpJson(command) : commandHelpJson(command);
}

export function rootHelpJson(program: Command) {
    return {
        usage: ['dexto [prompt]', 'dexto <command> [options]'],
        commands: program.commands.map((command) => ({
            name: command.name(),
            summary: command.description(),
            help: `dexto ${command.name()} --help --json`,
        })),
        output: 'JSON when stdout isn\'t a terminal; failures as {"error":{"code","message","fix"}} on stderr.',
        exit_codes: EXIT_CODE_MEANINGS,
    };
}

function commandHelpJson(command: Command) {
    const help = command.createHelp();
    return {
        usage: help.commandUsage(command),
        summary: command.description(),
        arguments: command.registeredArguments.map((argument) => ({
            name: argument.name(),
            required: argument.required,
            description: argument.description,
        })),
        options: help.visibleOptions(command).map((option) => ({
            name: option.flags,
            description: option.description,
        })),
        // Commander's implicit `help` command is not one of the command's own.
        commands: help
            .visibleCommands(command)
            .filter((each) => command.commands.includes(each))
            .map((each) => ({
                name: each.name(),
                summary: each.description(),
                help: `${commandPath(each)} --help --json`,
            })),
    };
}
