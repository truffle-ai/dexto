/**
 * The Signal log `dexto run` writes to stderr at a terminal: one time-stamped line per step, in
 * the same words as the TUI's step rows. On until the Signal look ships only with
 * DEXTO_PALETTE=signal; the bracketed tags stay the default until then.
 */
import { chalkStderr as chalk } from 'chalk';
import type { Step } from '@dexto/tui/tool-step';

const VERB_CELLS = 7;
const TARGET_CELLS = 30;
const DETAIL_CELLS = 16;

export function stepLogEnabled(): boolean {
    return process.env.DEXTO_PALETTE === 'signal';
}

function clock(at: Date): string {
    return chalk.dim(at.toLocaleTimeString('en-GB', { hour12: false }));
}

/** A line that isn't a tool call: start, done, an error. */
export function logLine(
    word: string,
    text: string,
    { error, at = new Date() }: { error: boolean; at?: Date }
): string {
    const label = word.padEnd(VERB_CELLS);
    return `${clock(at)}  ${error ? chalk.red(label) : chalk.bold(label)} ${text}`;
}

export function startLine(model: string, chatId: string, at: Date = new Date()): string {
    return logLine('start', `${model} · local · chat ${chatId}`, { error: false, at });
}

const STATE_WORD: Readonly<Partial<Record<Step['state'], string>>> = {
    ok: 'ok',
    fail: 'fail',
    deny: 'denied',
    stop: 'stopped',
};

/** One finished tool call as one line: verb, target, detail, time, state. */
export function stepLine(step: Step, at: Date = new Date()): string {
    const failed = step.state === 'fail';
    const word = STATE_WORD[step.state] ?? step.state;
    return [
        `${clock(at)} `,
        chalk.bold(step.verb.toLowerCase().padEnd(VERB_CELLS)),
        step.target.padEnd(TARGET_CELLS),
        (step.detail ?? '').padEnd(DETAIL_CELLS),
        (step.time ?? '').padStart(5),
        ` ${failed ? chalk.red(word) : chalk.dim(word)}`,
    ].join(' ');
}
