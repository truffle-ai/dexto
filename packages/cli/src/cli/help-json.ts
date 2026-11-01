// `dexto --help --json`: the commands and the frozen exit codes, for agents.

import type { Command } from 'commander';
import { EXIT_CODE_MEANINGS } from './cloud/command.js';

/** `--help` (or `-h`) with `--json`, and nothing else. */
export function isRootJsonHelp(args: readonly string[]): boolean {
    return (
        args.length === 2 &&
        args.includes('--json') &&
        (args.includes('--help') || args.includes('-h'))
    );
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
