// The process the cloud commands run in, injected so tests drive the public command boundary.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import chalk from 'chalk';

export interface CloudRuntime {
    /** Whether to color what people read: a terminal that shows colors. */
    readonly color: boolean;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly fetch: typeof globalThis.fetch;
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
    readonly stdoutIsTerminal: boolean;
    /** Raw bytes to stdout, such as a downloaded file. */
    readonly writeBytes: (chunk: Uint8Array) => Promise<void>;
    readonly writeError: (text: string) => void;
    readonly writeOutput: (text: string) => void;
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
