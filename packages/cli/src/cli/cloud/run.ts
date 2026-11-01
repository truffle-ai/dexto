// Runs `dexto cloud …` and the other ported cloud commands: global options, help, the agent
// contract's JSON output and exit codes, and signing in again for a permission a command lacked.

import { parseArgs } from 'node:util';
import { CloudApiError, createCloudClient } from '@dexto/cloud-client';
import {
    CommandFailure,
    EXIT_CODES,
    MissingScopeFailure,
    signInCommand,
    UsageError,
    type Command,
    type CommandContext,
    type FailureKind,
    type OptionSpec,
    type SignInContext,
} from './command.js';
import type { SignInFor } from './commands/account.js';
import type { Connection, ConnectionOverrides } from './connection.js';
import {
    listWorkspaceApps,
    runWorkspaceApp,
    type WorkspaceApp,
} from './commands/workspace-apps.js';
import { createOutput, type OutputFormat } from './output.js';
import type { CloudRuntime } from './runtime.js';

/** One area of commands in help, such as `projects` under `cloud`. */
export interface Group {
    readonly name: string;
    readonly summary: string;
}

/** What the commands run against: injected so tests use a fake server and sign-in. */
export interface CloudHost {
    readonly commands: readonly Command[];
    /** Help's areas by the words before them, such as `cloud`. */
    readonly groups: Readonly<Record<string, readonly Group[]>>;
    readonly runtime: CloudRuntime;
    /** The connection for these overrides; null when signed out. */
    readonly resolveConnection: (overrides: ConnectionOverrides) => Promise<Connection | null>;
    /** The sign-in context login, logout, whoami and accounts run in. */
    readonly signIn: SignInFor;
    /** Signs the profile in again asking for `scope`; true once it did. */
    readonly signInForScope: (overrides: ConnectionOverrides, scope: string) => Promise<boolean>;
}

export const GLOBAL_OPTIONS: Readonly<Record<string, OptionSpec>> = {
    'api-base-url': {
        description: 'The API origin (default https://api.dexto.ai, or DEXTO_API_BASE_URL).',
        type: 'string',
        valueName: 'URL',
    },
    'api-key': {
        description: 'Use this key instead of DEXTO_API_KEY or the saved sign-in.',
        type: 'string',
        valueName: 'KEY',
    },
    profile: {
        description:
            'The saved sign-in to use for this run (or DEXTO_PROFILE); see dexto accounts list.',
        type: 'string',
        valueName: 'NAME',
    },
    project: {
        description: "The Cloud project to act in when you're signed in (or DEXTO_CLOUD_PROJECT).",
        type: 'string',
        valueName: 'ID',
    },
    help: { description: 'Show help.', short: 'h', type: 'boolean' },
    json: {
        description:
            "Print JSON, failures included (on stderr). The default when stdout isn't a terminal.",
        type: 'boolean',
    },
    table: {
        description: "Print tables for people even when stdout isn't a terminal.",
        type: 'boolean',
    },
};

const NO_OVERRIDES: ConnectionOverrides = {
    apiBaseUrl: null,
    apiKey: null,
    cloudProject: null,
    profile: null,
};

/** Runs one command line, such as `cloud secrets list --json`; returns its exit code. */
export async function runCloud(host: CloudHost, argv: readonly string[]): Promise<number> {
    return await run(host, argv, true);
}

async function run(host: CloudHost, argv: readonly string[], mayGrant: boolean): Promise<number> {
    const { runtime } = host;
    let globals: Globals;
    try {
        globals = extractGlobals(argv);
    } catch (error) {
        // The format isn't settled yet: JSON as asked, or when no one reads stdout.
        return reportError(
            { overrides: NO_OVERRIDES, runtime },
            argv.includes('--json') || !runtime.stdoutIsTerminal,
            groupHelp(host, argv.slice(0, 1)),
            error
        );
    }
    const { command, words, rest } = matchCommand(host.commands, globals.rest);
    // `workspace` alone lists the apps; `workspace <app> …` is one of them, its operations from the
    // server. The CLI's own `workspace` commands, such as `tools` and `drive put`, match above.
    if (command === null && words[0] === 'workspace')
        return await runWorkspace(host, globals, argv, mayGrant);
    if (command === null) {
        if (!host.commands.some((each) => startsWith(each.path, words)))
            return reportError(
                { overrides: globals.overrides, runtime },
                createOutput(runtime, globals.format).json,
                groupHelp(host, words.slice(0, 1)),
                new UsageError(`Unknown command: dexto ${words.join(' ')}`)
            );
        return printHelp(runtime, globals, groupHelp(host, words), groupHelpJson(host, words));
    }
    if (globals.help)
        return printHelp(runtime, globals, commandHelp(command), commandHelpJson(command));

    const output = createOutput(runtime, globals.format);
    const signIn: SignInContext = { overrides: globals.overrides, runtime };
    try {
        const parsed = parseArgs({
            allowPositionals: true,
            args: [...rest],
            options: Object.fromEntries(
                Object.entries(command.options ?? {}).map(([name, spec]) => [
                    name,
                    {
                        type: spec.type,
                        ...(spec.multiple === true ? { multiple: true } : {}),
                        ...(spec.short === undefined ? {} : { short: spec.short }),
                    },
                ])
            ),
            strict: true,
        });
        const required = (command.arguments ?? '').match(/<[^>]+>/gu)?.length ?? 0;
        if (parsed.positionals.length < required)
            throw new UsageError(`Missing arguments: ${command.arguments ?? ''}`);
        return (await command.run(contextFor(host, globals, output), parsed)) ?? 0;
    } catch (thrown) {
        const error = asMissingScope(signIn, thrown);
        if (
            mayGrant &&
            error instanceof MissingScopeFailure &&
            runtime.prompt !== null &&
            !output.json &&
            (await askToGrant(host, globals.overrides, error))
        )
            return await run(host, argv, false);
        return reportError(signIn, output.json, commandHelp(command), error);
    }
}

/** `workspace` or `workspace <app> [operation] [action] [--field value…]`. */
async function runWorkspace(
    host: CloudHost,
    globals: Globals,
    argv: readonly string[],
    mayGrant: boolean
): Promise<number> {
    const output = createOutput(host.runtime, globals.format);
    const context = contextFor(host, globals, output);
    const args = globals.rest.slice(1);
    try {
        if (args.every((arg) => arg.startsWith('-'))) {
            const apps = await listWorkspaceApps(context);
            return printHelp(host.runtime, globals, workspaceHelp(host, apps), {
                apps,
                ...groupHelpJson(host, ['workspace']),
            });
        }
        const appId = args[0] ?? '';
        return await runWorkspaceApp(
            context,
            args,
            globals.help,
            host.commands
                .filter((each) => each.path[0] === 'workspace' && each.path[1] === appId)
                .map((each) => ({
                    name: each.path.slice(2).join(' '),
                    summary: each.summary,
                    usage: `dexto ${usage(each)}`,
                }))
        );
    } catch (thrown) {
        const error = asMissingScope(context, thrown);
        if (
            mayGrant &&
            error instanceof MissingScopeFailure &&
            host.runtime.prompt !== null &&
            !output.json &&
            (await askToGrant(host, globals.overrides, error))
        )
            return await run(host, argv, false);
        return reportError(context, output.json, workspaceHelp(host, null), error);
    }
}

/** The workspace's apps, when listed, and the CLI's own workspace commands. */
function workspaceHelp(host: CloudHost, apps: readonly WorkspaceApp[] | null): string {
    const commands = host.commands.filter((command) => command.path[0] === 'workspace');
    const usages = commands.map((command) => usage(command));
    const width = Math.max(...usages.map((line) => line.length));
    return [
        'Usage: dexto workspace <app> [operation] [--field value…] [--yes]',
        '       dexto workspace <command>',
        '',
        'Use your Dexto workspace as yourself: the apps and tools your agents use over the Dexto MCP.',
        '',
        "Your workspace's apps (dexto workspace <app> lists what each does):",
        ...(apps === null
            ? ['  Run dexto workspace while signed in to list them.']
            : apps.length === 0
              ? ['  None yet.']
              : [`  ${apps.map((app) => app.id).join(' · ')}`]),
        '',
        'Commands:',
        ...commands.map(
            (command, index) => `  ${(usages[index] ?? '').padEnd(width)}  ${command.summary}`
        ),
        '',
        'Find what to run: dexto find "<what you want to do>"',
        '',
    ].join('\n');
}

/** At a terminal, offers to sign in again for the permission; true once that sign-in succeeded. */
async function askToGrant(
    host: CloudHost,
    overrides: ConnectionOverrides,
    error: MissingScopeFailure
): Promise<boolean> {
    const answer =
        (await host.runtime.prompt?.(`${error.message} Sign in again to grant it? [y/N] `, {
            secret: false,
        })) ?? '';
    if (!/^y(es)?$/iu.test(answer.trim())) return false;
    return await host.signInForScope(overrides, error.scope);
}

function contextFor(
    host: CloudHost,
    globals: Globals,
    output: CommandContext['output']
): CommandContext {
    const { overrides } = globals;
    const connection = async (): Promise<Connection> => {
        const resolved = await host.resolveConnection(overrides);
        if (resolved !== null) return resolved;
        throw new CommandFailure(
            'needs_sign_in',
            'Not signed in. Sign in, or set DEXTO_API_KEY to a developer key from your Cloud project.',
            signInCommand({ overrides, runtime: host.runtime }, null)
        );
    };
    return {
        client: async () => {
            const resolved = await connection();
            return createCloudClient({
                apiBaseUrl: resolved.apiBaseUrl,
                token: resolved.token,
                // A key acts in its own project; only a person's token names one.
                cloudProject: resolved.kind === 'oauth' ? resolved.cloudProject : null,
                fetch: host.runtime.fetch,
            });
        },
        connection,
        invocation: globals.invocation,
        output,
        overrides,
        runtime: host.runtime,
    };
}

/** A `/v1` refusal that names the scope the sign-in lacks; any other error as it is. */
function asMissingScope(context: SignInContext, error: unknown): unknown {
    if (!(error instanceof CloudApiError) || error.status !== 403) return error;
    const details = error.details;
    const scope =
        typeof details === 'object' && details !== null && 'scope' in details
            ? details.scope
            : undefined;
    if (typeof scope !== 'string') return error;
    return new MissingScopeFailure(context, scope, error.message);
}

interface FailureReport {
    readonly code: FailureKind | 'usage';
    readonly details: unknown;
    /** The API's own error code, such as `budget_exceeded`, when it gave one. */
    readonly apiCode: string | null;
    readonly fix: string | null;
    readonly message: string;
}

/**
 * Prints a failure and returns its exit code: JSON on stderr for agents, otherwise a message with
 * the command's usage (for a usage mistake) or the command that fixes it.
 */
function reportError(context: SignInContext, json: boolean, help: string, error: unknown): number {
    const { runtime } = context;
    const failure = describeFailure(context, error);
    if (json) {
        runtime.writeError(
            `${JSON.stringify(
                {
                    error: {
                        code: failure.code,
                        message: failure.message,
                        ...(failure.fix === null ? {} : { fix: failure.fix }),
                        ...(failure.apiCode === null ? {} : { api_code: failure.apiCode }),
                        ...(failure.details === null ? {} : { details: failure.details }),
                    },
                },
                null,
                2
            )}\n`
        );
    } else if (failure.code === 'usage') {
        runtime.writeError(`${failure.message}\n\n${help}`);
    } else {
        runtime.writeError(
            `Error${failure.apiCode === null ? '' : ` (${failure.apiCode})`}: ${failure.message}\n`
        );
        if (failure.details !== null)
            runtime.writeError(`${JSON.stringify(failure.details, null, 2)}\n`);
        if (failure.fix !== null) runtime.writeError(`Run: ${failure.fix}\n`);
    }
    return EXIT_CODES[failure.code];
}

function describeFailure(context: SignInContext, error: unknown): FailureReport {
    const report = (
        code: FailureReport['code'],
        message: string,
        fix: string | null,
        apiCode: string | null,
        details: unknown
    ): FailureReport => ({ apiCode, code, details: details ?? null, fix, message });
    if (error instanceof UsageError || isParseArgsError(error))
        return report('usage', error.message, null, null, null);
    if (error instanceof CommandFailure)
        return report(error.kind, error.message, error.fix, null, null);
    if (error instanceof CloudApiError) {
        if (error.status === 401)
            return report(
                'needs_sign_in',
                error.message,
                signInCommand(context, null),
                error.code,
                error.details
            );
        return report(
            error.status === 403
                ? 'needs_permission'
                : error.status === 404
                  ? 'not_found'
                  : error.status === 400 || error.status === 413 || error.status === 422
                    ? 'invalid_input'
                    : 'failed',
            error.message,
            null,
            error.code,
            error.details
        );
    }
    if (error instanceof Error) return report('failed', error.message, null, null, null);
    return report('failed', 'The command failed.', null, null, null);
}

interface Globals {
    readonly format: OutputFormat;
    readonly help: boolean;
    /** The words as run, without any key, for commands that suggest running them again. */
    readonly invocation: readonly string[];
    readonly overrides: ConnectionOverrides;
    readonly rest: readonly string[];
}

/** Takes the global options out wherever they appear, before the command's own parsing. */
function extractGlobals(argv: readonly string[]): Globals {
    const rest: string[] = [];
    let apiBaseUrl: string | null = null;
    let apiKey: string | null = null;
    let cloudProject: string | null = null;
    let profile: string | null = null;
    let help = false;
    let json = false;
    let table = false;
    const invocation: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index] ?? '';
        if (token === '--') {
            rest.push(...argv.slice(index));
            invocation.push(...argv.slice(index));
            break;
        }
        const [name, inline] = token.startsWith('--') ? splitOption(token) : [token, null];
        if (
            name === '--api-key' ||
            name === '--api-base-url' ||
            name === '--profile' ||
            name === '--project'
        ) {
            const value = inline ?? argv[index + 1];
            // Never take another option as the value, so `--project --api-key KEY` can't leave
            // the key behind as a word that gets printed back.
            if (value === undefined || (inline === null && value.startsWith('-')))
                throw new UsageError(`Missing value for ${name}.`);
            if (inline === null) index += 1;
            if (name === '--api-key') apiKey = value;
            else {
                invocation.push(name, value);
                if (name === '--project') cloudProject = value;
                else if (name === '--profile') profile = value;
                else apiBaseUrl = value;
            }
            continue;
        }
        if (token === '--json') json = true;
        else if (token === '--table') table = true;
        else if (token === '--help' || token === '-h') help = true;
        else rest.push(token);
        if (token !== '--help' && token !== '-h') invocation.push(token);
    }
    if (json && table) throw new UsageError('Pass --json or --table, not both.');
    return {
        format: json ? 'json' : table ? 'table' : 'auto',
        help,
        invocation,
        overrides: { apiBaseUrl, apiKey, cloudProject, profile },
        rest,
    };
}

function splitOption(token: string): [string, string | null] {
    const equals = token.indexOf('=');
    return equals === -1 ? [token, null] : [token.slice(0, equals), token.slice(equals + 1)];
}

/** The longest command whose path the leading words spell. */
function matchCommand(
    commands: readonly Command[],
    tokens: readonly string[]
): { command: Command | null; rest: readonly string[]; words: readonly string[] } {
    const words: string[] = [];
    for (const token of tokens) {
        if (token.startsWith('-')) break;
        const next = [...words, token];
        if (!commands.some((command) => startsWith(command.path, next))) break;
        words.push(token);
    }
    for (let length = words.length; length > 0; length -= 1) {
        const prefix = words.slice(0, length);
        const command = commands.find(
            (each) => each.path.length === length && startsWith(each.path, prefix)
        );
        if (command !== undefined) return { command, rest: tokens.slice(length), words: prefix };
    }
    const rest = tokens.slice(words.length);
    // A word after a group that names none of its commands, such as `cloud chat`, is unknown.
    const unknown = rest[0] !== undefined && !rest[0].startsWith('-') ? [rest[0]] : [];
    return {
        command: null,
        rest,
        words:
            words.length === 0
                ? tokens.filter((token) => !token.startsWith('-'))
                : [...words, ...unknown],
    };
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
    return prefix.every((word, index) => path[index] === word);
}

/** Help as text for people, or as JSON where the output is JSON. */
function printHelp(runtime: CloudRuntime, globals: Globals, text: string, json: unknown): number {
    if (createOutput(runtime, globals.format).json)
        runtime.writeOutput(`${JSON.stringify(json, null, 2)}\n`);
    else runtime.writeOutput(text);
    return 0;
}

/** A layer's own areas when it has them, otherwise its commands with their usage. */
function groupHelp(host: CloudHost, words: readonly string[]): string {
    const areas = host.groups[words.join(' ')];
    if (areas !== undefined) {
        const width = Math.max(...areas.map((group) => group.name.length));
        return [
            `Usage: dexto ${words.join(' ')} <command>`,
            '',
            'Commands:',
            ...areas.map((group) => `  ${group.name.padEnd(width)}  ${group.summary}`),
            '',
            'Global options:',
            ...optionLines(GLOBAL_OPTIONS),
            '',
            "Output is JSON when stdout isn't a terminal; a failure's JSON on stderr names the command",
            'that fixes it. Exit codes: 0 done, 1 failed, 2 usage, 3 needs sign-in or permission,',
            '4 needs --yes (pass it only once your person has agreed), 5 not found, 6 waiting on a',
            'person (such as an approval).',
            '',
        ].join('\n');
    }
    const commands = host.commands.filter((command) => startsWith(command.path, words));
    const usages = commands.map((command) => usage(command));
    const width = Math.max(...usages.map((line) => line.length));
    return [
        `Usage: dexto ${words.join(' ')} <command>`,
        '',
        'Commands:',
        ...commands.map(
            (command, index) => `  ${(usages[index] ?? '').padEnd(width)}  ${command.summary}`
        ),
        '',
    ].join('\n');
}

function groupHelpJson(host: CloudHost, words: readonly string[]): Record<string, unknown> {
    return {
        commands: host.commands
            .filter((command) => startsWith(command.path, words))
            .map((command) => ({ summary: command.summary, usage: `dexto ${usage(command)}` })),
        exit_codes: {
            '0': 'done',
            '1': 'failed',
            '2': 'usage or invalid input',
            '3': 'needs sign-in or permission',
            '4': 'needs confirmation: pass --yes once your person has agreed',
            '5': 'not found',
            '6': 'waiting on a person, such as an approval',
        },
        usage: `dexto ${words.join(' ')} <command>`,
    };
}

function commandHelp(command: Command): string {
    return [
        `Usage: dexto ${usage(command)}${command.options === undefined ? '' : ' [options]'}`,
        '',
        command.summary,
        '',
        ...(command.options === undefined ? [] : ['Options:', ...optionLines(command.options), '']),
        'Global options:',
        ...optionLines(GLOBAL_OPTIONS),
        '',
    ].join('\n');
}

function commandHelpJson(command: Command): unknown {
    return {
        options: Object.entries({ ...command.options, ...GLOBAL_OPTIONS }).map(([name, spec]) => ({
            description: spec.description,
            name: `--${name}`,
            type: spec.type,
            ...(spec.multiple === true ? { multiple: true } : {}),
        })),
        summary: command.summary,
        usage: `dexto ${usage(command)}`,
    };
}

function usage(command: Command): string {
    return [...command.path, ...(command.arguments === undefined ? [] : [command.arguments])].join(
        ' '
    );
}

function optionLines(options: Readonly<Record<string, OptionSpec>>): string[] {
    const labels = Object.entries(options).map(
        ([name, spec]) =>
            `${spec.short === undefined ? '    ' : `-${spec.short}, `}--${name}${
                spec.type === 'string' ? ` ${spec.valueName ?? 'VALUE'}` : ''
            }${spec.multiple === true ? ' ...' : ''}`
    );
    const width = Math.max(...labels.map((label) => label.length));
    return Object.values(options).map(
        (spec, index) => `  ${(labels[index] ?? '').padEnd(width)}  ${spec.description}`
    );
}

function isParseArgsError(error: unknown): error is Error {
    return (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('ERR_PARSE_ARGS_')
    );
}
