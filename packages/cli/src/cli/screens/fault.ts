/**
 * The Signal fault block for a failed command (screen 6): on stderr, what went wrong and the
 * command that fixes it. Behind DEXTO_PALETTE=signal; exit codes and JSON errors are unchanged.
 */
import { faultLines, line, span, signalOn } from '@dexto/tui/signal-text';
import { NOT_SIGNED_IN, type FailureKind } from '../failure.js';
import { signedOutLines } from './whoami.js';

export interface Failure {
    readonly code: FailureKind | 'usage';
    readonly message: string;
    readonly apiCode: string | null;
    readonly details: unknown;
    readonly fix: string | null;
}

/**
 * A usage mistake points at help instead of printing all of it. Being signed out is not a fault
 * when local works without it.
 */
export function failureLines(failure: Failure, helpCommand: string): string[] {
    if (failure.code === 'needs_sign_in' && failure.message === NOT_SIGNED_IN)
        return signedOutLines();
    if (failure.code === 'usage')
        return [
            ...faultLines({ message: failure.message, apiCode: null, details: null, fix: null }),
            '',
            line([
                span(
                    'dim',
                    `  ${helpCommand === 'dexto --help' ? 'every command' : 'this command'}: `
                ),
                span('teal', helpCommand),
            ]),
        ];
    return faultLines({
        message: failure.message,
        apiCode: failure.apiCode,
        details: failure.details === null ? null : JSON.stringify(failure.details),
        fix: failure.fix,
    });
}

/**
 * A failure before any command runs, such as a missing key: the Signal fault, or the lines it
 * replaces until Signal ships.
 */
export function printFault(
    fault: { readonly message: string; readonly fix: string | null },
    legacy: readonly string[]
): void {
    if (!signalOn()) {
        for (const each of legacy) console.error(each);
        return;
    }
    process.stderr.write(
        `${faultLines({ message: fault.message, apiCode: null, details: null, fix: fault.fix }).join('\n')}\n`
    );
}
