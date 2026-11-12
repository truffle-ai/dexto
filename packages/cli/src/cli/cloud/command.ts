// The shape every cloud command shares: its path, arguments, options and handler.
import { readFile } from 'node:fs/promises';

import type { CloudClient } from '@dexto/cloud-client';

import { CommandFailure } from '../failure.js';
import { isSshSession } from '../auth/ssh.js';
import { shellWord } from '../interaction.js';

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
    /** Available to local chat commands registered by the CLI runtime. */
    readonly openLocalAgent?: () => Promise<import('@dexto/core').DextoAgent>;
    readonly syncLocalChat?: (id: string) => Promise<void>;
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

/** A permission the sign-in lacks: signing in again for `scope` (one, or several comma-separated) fixes it. */
export class MissingScopeFailure extends CommandFailure {
    /** Every permission the sign-in lacks, each its own OAuth scope. */
    readonly scopes: readonly string[];

    constructor(context: SignInContext, scopes: readonly string[], message: string) {
        if (scopes.length === 0)
            throw new Error('A missing-scope failure names at least one scope.');
        super('needs_permission', message, signInCommand(context, scopes));
        this.name = 'MissingScopeFailure';
        this.scopes = scopes;
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

/** A string option that must be one of `values`, checked before anything is sent. */
export function choiceOption<const T extends string>(
    input: CommandInput,
    name: string,
    values: readonly T[]
): T | undefined {
    const value = stringOption(input, name);
    if (value === undefined) return undefined;
    const found = values.find((each) => each === value);
    if (found === undefined)
        throw new UsageError(`--${name} must be one of: ${values.join(', ')}.`);
    return found;
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
    context: Pick<CommandContext, 'runtime'>,
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

export const YES_OPTION = {
    yes: {
        description: 'Go ahead without being asked. Pass it only once your person has agreed.',
        type: 'boolean',
    },
} as const satisfies Record<string, OptionSpec>;

/**
 * Whether a sign-in here should use a device code: no one is at this terminal, or it is an SSH
 * session, whose loopback redirect a browser on the person's own device can't reach.
 */
export function signsInWithDevice(runtime: CloudRuntime): boolean {
    return runtime.prompt === null || isSshSession(runtime.environment);
}

/** What saying how to sign in again needs: the process, and the profile `--profile` chose. */
export type SignInContext = Pick<CommandContext, 'overrides' | 'runtime'>;

/** How a cloud command signs in again, using its profile and terminal. */
export function signInCommand(context: SignInContext, scopes: readonly string[]): string {
    return loginCommand(
        { profile: context.overrides.profile, device: signsInWithDevice(context.runtime) },
        scopes
    );
}

/**
 * How to sign in again, to the same app and profile, with a device code where a browser can't
 * finish it.
 */
export function loginCommand(
    input: { readonly profile: string | null; readonly device: boolean },
    scopes: readonly string[]
): string {
    const profile = input.profile;
    return [
        'dexto',
        'login',
        ...(profile === null ? [] : ['--profile', profile]),
        ...(input.device ? ['--device'] : []),
        ...scopes.flatMap((scope) => ['--scope', scope]),
    ]
        .map(shellWord)
        .join(' ');
}
