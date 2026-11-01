// The shape every cloud command shares: its path, arguments, options and handler.
import { readFile } from 'node:fs/promises';

import type { CloudClient } from '@dexto/cloud-client';

import type { Connection, ConnectionOverrides } from './connection.js';
import type { Output } from './output.js';
import type { CloudRuntime } from './runtime.js';

export interface OptionSpec {
    readonly description: string;
    readonly multiple?: true;
    readonly short?: string;
    readonly type: 'boolean' | 'string';
    /** The value's name in help, such as ID; string options only. */
    readonly valueName?: string;
}

export interface Command {
    /** Such as `<agent_id> [message...]`; `<x>` is required, `[x]` optional. */
    readonly arguments?: string;
    readonly options?: Readonly<Record<string, OptionSpec>>;
    /** The words that select it, such as ["agents", "sessions", "list"]. */
    readonly path: readonly string[];
    readonly summary: string;
    run(context: CommandContext, input: CommandInput): Promise<number | void>;
}

export interface CommandInput {
    readonly positionals: readonly string[];
    readonly values: Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>;
}

export interface CommandContext {
    /** The /v1 client for the resolved credential; fails with how to sign in when there is none. */
    client(): Promise<CloudClient>;
    connection(): Promise<Connection>;
    /** The words the command was run with, its connection options included and any key left out. */
    readonly invocation: readonly string[];
    readonly output: Output;
    readonly overrides: ConnectionOverrides;
    readonly runtime: CloudRuntime;
}

/** A mistake in how the command was called: printed with the command's usage. */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

/** What kind of thing went wrong; each kind has an exit code an agent can branch on. */
export type FailureKind =
    | 'failed'
    | 'invalid_input'
    | 'needs_confirmation'
    | 'needs_permission'
    | 'needs_sign_in'
    | 'not_found'
    | 'waiting_on_person';

export const EXIT_CODES = {
    failed: 1,
    invalid_input: 2,
    needs_confirmation: 4,
    needs_permission: 3,
    needs_sign_in: 3,
    not_found: 5,
    waiting_on_person: 6,
    usage: 2,
} as const satisfies Record<FailureKind | 'usage', number>;

/** What each exit code means; frozen in 2.0 and shown in help. */
export const EXIT_CODE_MEANINGS = {
    '0': 'done',
    '1': 'failed',
    '2': 'usage or invalid input',
    '3': 'needs sign-in or permission',
    '4': 'needs confirmation: pass --yes once your person has agreed',
    '5': 'not found',
    '6': 'waiting on a person, such as an approval',
} as const;

/** A failure that says what kind it is and, where there is one, the command that fixes it. */
export class CommandFailure extends Error {
    readonly fix: string | null;
    readonly kind: FailureKind;

    constructor(kind: FailureKind, message: string, fix: string | null) {
        super(message);
        this.name = 'CommandFailure';
        this.fix = fix;
        this.kind = kind;
    }
}

/** A permission the sign-in lacks: signing in again for `scope` (one, or several comma-separated) fixes it. */
export class MissingScopeFailure extends CommandFailure {
    readonly scope: string;

    constructor(context: SignInContext, scope: string, message: string) {
        super('needs_permission', message, signInCommand(context, scope));
        this.name = 'MissingScopeFailure';
        this.scope = scope;
    }
}

export function stringOption(input: CommandInput, name: string): string | undefined {
    const value = input.values[name];
    return typeof value === 'string' ? value : undefined;
}

export function requiredOption(input: CommandInput, name: string): string {
    const value = stringOption(input, name);
    if (value === undefined) throw new UsageError(`--${name} is required.`);
    return value;
}

export function listOption(input: CommandInput, name: string): string[] {
    const value = input.values[name];
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

export function flag(input: CommandInput, name: string): boolean {
    return input.values[name] === true;
}

export function integerOption(input: CommandInput, name: string): number | undefined {
    const value = stringOption(input, name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new UsageError(`--${name} must be a whole number.`);
    return parsed;
}

export function argument(input: CommandInput, index: number, name: string): string {
    const value = input.positionals[index];
    if (value === undefined) throw new UsageError(`Missing ${name}.`);
    return value;
}

/** `--limit` and `--after`, which every list takes. */
export const PAGE_OPTIONS = {
    after: {
        description: 'Start after this cursor, from the previous page.',
        type: 'string',
        valueName: 'CURSOR',
    },
    limit: { description: 'How many to return.', type: 'string', valueName: 'N' },
} as const satisfies Record<string, OptionSpec>;

export function pageQuery(input: CommandInput): { after?: string; limit?: number } {
    const after = stringOption(input, 'after');
    const limit = integerOption(input, 'limit');
    return {
        ...(after === undefined ? {} : { after }),
        ...(limit === undefined ? {} : { limit }),
    };
}

/** `--data <json>` and `--file <path|->`, for request bodies too rich for flags. */
export const BODY_OPTIONS = {
    data: { description: 'The request body as JSON.', type: 'string', valueName: 'JSON' },
    file: {
        description: 'Read the request body from a JSON file, or - for stdin.',
        type: 'string',
        valueName: 'PATH',
    },
} as const satisfies Record<string, OptionSpec>;

/** The JSON body from --data or --file; null when neither was given. */
export async function readJsonBody(context: CommandContext, input: CommandInput): Promise<unknown> {
    const data = stringOption(input, 'data');
    const file = stringOption(input, 'file');
    if (data !== undefined && file !== undefined)
        throw new UsageError('Pass --data or --file, not both.');
    const text =
        data ??
        (file === undefined
            ? null
            : file === '-'
              ? await context.runtime.readStdin()
              : await readFile(file, 'utf8'));
    if (text === null) return null;
    try {
        return JSON.parse(text);
    } catch {
        throw new UsageError(`The request body is not valid JSON${file ? ` (${file})` : ''}.`);
    }
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value the person types, hidden when secret, or piped on stdin. */
export async function readValue(
    context: CommandContext,
    question: string,
    secret: boolean
): Promise<string> {
    const value =
        context.runtime.prompt === null
            ? (await context.runtime.readStdin()).replace(/\r?\n$/u, '')
            : await context.runtime.prompt(question, { secret });
    if (value.length === 0) throw new UsageError('No value was given.');
    return value;
}

/** Asks yes or no at a terminal; without one, only `--yes` agrees. */
export async function confirm(context: CommandContext, question: string): Promise<boolean> {
    if (context.runtime.prompt === null) return false;
    const answer = await context.runtime.prompt(`${question} [y/N] `, { secret: false });
    return /^y(es)?$/iu.test(answer.trim());
}

export const YES_OPTION = {
    yes: {
        description: 'Go ahead without being asked. Pass it only once your person has agreed.',
        type: 'boolean',
    },
} as const satisfies Record<string, OptionSpec>;

/**
 * Goes ahead with something that asks first: at once with `--yes`, after a yes at a terminal, and
 * otherwise not at all, failing with the command that goes ahead.
 */
export async function requireConsent(
    context: CommandContext,
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

/** The command as it was run plus more words, quoted to paste into a shell. */
export function rerunWith(context: CommandContext, ...extra: string[]): string {
    return ['dexto', ...context.invocation, ...extra].map(shellWord).join(' ');
}

/**
 * Whether a sign-in here should use a device code: no one is at this terminal, or it is an SSH
 * session, whose loopback redirect a browser on the person's own device can't reach.
 */
export function signsInWithDevice(runtime: CloudRuntime): boolean {
    return (
        runtime.prompt === null ||
        runtime.environment.SSH_CONNECTION !== undefined ||
        runtime.environment.SSH_TTY !== undefined
    );
}

/** What saying how to sign in again needs: the process, and the profile `--profile` chose. */
export type SignInContext = Pick<CommandContext, 'overrides' | 'runtime'>;

/**
 * How to sign in again, to the same app and profile, with a device code where a browser can't
 * finish it.
 */
export function signInCommand(context: SignInContext, scope: string | null): string {
    const profile = context.overrides.profile;
    return [
        'dexto',
        'login',
        ...(profile === null ? [] : ['--profile', profile]),
        ...(signsInWithDevice(context.runtime) ? ['--device'] : []),
        ...(scope === null ? [] : ['--scope', scope]),
    ]
        .map(shellWord)
        .join(' ');
}

/** A word as a shell reads it: quoted unless it is plain. */
export function shellWord(word: string): string {
    return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
