// Commander's own usage errors (`dexto --bogus`, `dexto chat bogus`, a missing argument): exit 2
// like a mistyped command (the output contract), not Commander's 1, and the JSON error where the
// output is JSON, as the cloud command engine prints its own.

import { commandPath } from './help-json.js';
import { jsonError } from './output.js';

import type { Command } from 'commander';

const USAGE_ERRORS: ReadonlySet<string> = new Set([
    'commander.unknownCommand',
    'commander.unknownOption',
    'commander.excessArguments',
    'commander.missingArgument',
    'commander.optionMissingArgument',
    'commander.missingMandatoryOptionValue',
    'commander.invalidArgument',
    'commander.conflictingOption',
]);

/**
 * Call once every command is added: each command's error points at its own help. Help, version
 * and every other exit keep their code.
 */
export function routeUsageErrors(program: Command, json: boolean): void {
    for (const command of [program, ...descendants(program)]) {
        // Commander writes the error before it exits; the JSON error replaces that text.
        if (json) command.configureOutput({ outputError: () => {} });
        command.exitOverride((error) => {
            if (!USAGE_ERRORS.has(error.code)) return;
            if (json)
                process.stderr.write(
                    jsonError({
                        code: 'usage',
                        message: usageMessage(error.message),
                        fix: `${commandPath(command)} --help`,
                    })
                );
            process.exit(2);
        });
    }
}

function descendants(command: Command): Command[] {
    return command.commands.flatMap((each) => [each, ...descendants(each)]);
}

/** `error: unknown command 'x'\n(Did you mean y?)` as `Unknown command 'x' (Did you mean y?)`. */
function usageMessage(message: string): string {
    const text = message.replace(/^error: /, '').replace(/\s*\n\s*/g, ' ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
