import { CommandFailure } from './failure.js';
interface InteractionContext {
    readonly invocation: readonly string[];
    readonly runtime: {
        readonly prompt:
            | ((question: string, options: { secret: boolean }) => Promise<string>)
            | null;
    };
}

/** Asks yes or no at a terminal; without one, only an explicit flag agrees. */
export async function confirm(context: InteractionContext, question: string): Promise<boolean> {
    if (context.runtime.prompt === null) return false;
    const answer = await context.runtime.prompt(`${question} [y/N] `, { secret: false });
    return /^y(es)?$/iu.test(answer.trim());
}

/** Goes ahead with explicit consent or an interactive confirmation. */
export async function requireConsent(
    context: InteractionContext,
    yes: boolean,
    what: string
): Promise<void> {
    if (yes) return;
    if (context.runtime.prompt !== null) {
        if (await confirm(context, `${what} Go ahead?`)) return;
        throw new CommandFailure('needs_confirmation', 'Not done.', null);
    }
    throw new CommandFailure(
        'needs_confirmation',
        `${what} Run it again with --yes once your person has agreed.`,
        rerunWith(context, '--yes')
    );
}

export function requireInteractive(interactive: boolean, flag: string): void {
    if (!interactive)
        throw new CommandFailure(
            'invalid_input',
            `Pass ${flag} when running non-interactively.`,
            null
        );
}

/** The invocation with extra arguments, quoted for a shell. */
export function rerunWith(
    context: Pick<InteractionContext, 'invocation'>,
    ...extra: string[]
): string {
    return ['dexto', ...context.invocation, ...extra].map(shellWord).join(' ');
}

export function shellWord(word: string): string {
    return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
