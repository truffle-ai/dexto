import { CommandFailure } from './failure.js';

export async function requireConfirmation(options: {
    yes: boolean;
    interactive: boolean;
    prompt: () => Promise<boolean>;
    message: string;
    fix: string;
}): Promise<void> {
    if (options.yes) return;
    if (!options.interactive)
        throw new CommandFailure(
            'needs_confirmation',
            `${options.message} Run it again with --yes once your person has agreed.`,
            options.fix
        );
    if (!(await options.prompt()))
        throw new CommandFailure('needs_confirmation', 'Not done.', null);
}

export function requireInteractive(interactive: boolean, flag: string): void {
    if (!interactive)
        throw new CommandFailure(
            'invalid_input',
            `Pass ${flag} when running non-interactively.`,
            null
        );
}
