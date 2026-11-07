// The process the cloud commands run in, injected so tests drive the public command boundary.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import chalk from 'chalk';
import { safeText } from '@dexto/tui/signal-text';

export interface CloudRuntime {
    /** Whether to color what people read: a terminal that shows colors. */
    readonly color: boolean;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly fetch: typeof globalThis.fetch;
    /** Where other agents keep their chats, such as ~/.claude and ~/.codex. */
    readonly homeDirectory: string;
    /** Asks the person at the terminal; null when stdin is not a terminal. */
    readonly prompt: ((question: string, options: { secret: boolean }) => Promise<string>) | null;
    /** All of stdin as text, for piped input. */
    readonly readStdin: () => Promise<string>;
    /** Runs a program, such as a project's packer, and returns its exit code and what it printed. */
    readonly runProcess: (
        command: string,
        args: readonly string[],
        options: { readonly cwd: string }
    ) => Promise<ProcessResult>;
    readonly signal: AbortSignal;
    /** Waits, ending early with an error when the command is cancelled. */
    readonly sleep: (ms: number) => Promise<void>;
    /** Picks JSON or tables by default, and keeps a download's bytes off a terminal. */
    readonly stdoutIsTerminal: boolean;
    /** Raw bytes to stdout, such as a downloaded file. */
    readonly writeBytes: (chunk: Uint8Array) => Promise<void>;
    readonly writeError: (text: string) => void;
    readonly writeOutput: (text: string) => void;
    /**
     * Set by `guardRuntime`: the writers without the filter, for text that is styled (colour
     * escapes) and already clean. Read it through `unfiltered`.
     */
    readonly unfiltered?: Pick<CloudRuntime, 'writeError' | 'writeOutput'>;
}

/**
 * The runtime commands print through. Text has its control (C0, DEL, C1), bidi and invisible
 * characters taken out, so server text such as a name, an error or a model's reply can't move the
 * cursor, set the title, start a link or make a line read as something else. New commands are
 * covered without doing anything.
 *
 * - Text is always filtered, on stdout and stderr, at a terminal or not: a pipe can end at one
 *   (`| cat`, `| less -R`). Prompts are filtered too.
 * - Exact data is JSON: build it with `jsonResult` or `safeJson`, which escape instead of
 *   dropping, so it parses back to the same value. Raw JSON from `JSON.stringify` is filtered
 *   like any text (still valid JSON, but the characters are gone).
 * - Styled text (the tables, notes and sign-in screens) goes through `unfiltered`, and has to
 *   clean what it draws itself.
 * - `writeBytes` is a download's own bytes and is never filtered. Only a command that has
 *   refused a terminal may use it (see `files download`).
 */
export function guardRuntime(runtime: CloudRuntime): CloudRuntime {
    if (runtime.unfiltered !== undefined) return runtime;
    const { prompt } = runtime;
    return {
        ...runtime,
        prompt:
            prompt === null ? null : (question, options) => prompt(safeLines(question), options),
        unfiltered: runtime,
        writeError: (text) => runtime.writeError(safeLines(text)),
        writeOutput: (text) => runtime.writeOutput(safeLines(text)),
    };
}

/**
 * Text for people with each line's control, bidi and invisible characters taken out. Line breaks
 * stay (a CRLF becomes a newline); a tab or a lone carriage return becomes a space.
 */
export function safeLines(text: string): string {
    return text.split(/\r?\n/u).map(safeText).join('\n');
}

/** The writers for styled text that is already clean; see `guardRuntime`. */
export function unfiltered(
    runtime: CloudRuntime
): Pick<CloudRuntime, 'writeError' | 'writeOutput'> {
    return runtime.unfiltered ?? runtime;
}

export interface ProcessResult {
    readonly exitCode: number;
    /** Its stdout and stderr together, as a person would have seen them. */
    readonly output: string;
}

export function nodeCloudRuntime(signal: AbortSignal): CloudRuntime {
    return {
        color: process.stdout.isTTY === true && chalk.level > 0,
        environment: process.env,
        fetch: globalThis.fetch.bind(globalThis),
        homeDirectory: homedir(),
        prompt: process.stdin.isTTY === true ? promptAtTerminal : null,
        readStdin: async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
            return Buffer.concat(chunks).toString('utf8');
        },
        runProcess: (command, args, options) => runProcess(command, args, options.cwd, signal),
        signal,
        sleep: (ms) => delay(ms, undefined, { signal }),
        stdoutIsTerminal: process.stdout.isTTY === true,
        writeBytes: (chunk) =>
            new Promise((resolve, reject) =>
                process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()))
            ),
        writeError: (text) => {
            process.stderr.write(text);
        },
        writeOutput: (text) => {
            process.stdout.write(text);
        },
    };
}

function runProcess(
    command: string,
    args: readonly string[],
    cwd: string,
    signal: AbortSignal
): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
        child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
        child.once('error', reject);
        child.once('close', (code) => resolve({ exitCode: code ?? 1, output }));
    });
}

async function promptAtTerminal(question: string, options: { secret: boolean }): Promise<string> {
    if (options.secret) return await readHidden(question);
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    try {
        return await readline.question(question);
    } finally {
        readline.close();
    }
}

/** Reads a line without echoing it, for API keys and secret values. */
function readHidden(question: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        let value = '';
        const finish = (error: Error | null) => {
            input.off('data', onData);
            input.setRawMode(false);
            input.pause();
            process.stderr.write('\n');
            if (error === null) resolve(value);
            else reject(error);
        };
        const onData = (chunk: Buffer) => {
            for (const character of chunk.toString('utf8')) {
                if (character === '\r' || character === '\n') return finish(null);
                if (character === '\u0003') return finish(new Error('Cancelled.'));
                if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
                else value += character;
            }
        };
        process.stderr.write(question);
        input.setRawMode(true);
        input.resume();
        input.on('data', onData);
    });
}
