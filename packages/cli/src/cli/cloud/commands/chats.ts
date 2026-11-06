// Discover local chats, import them, and start cloud chats with owned computer and browser choices.

import { requireConsent } from '../../interaction.js';
import { CommandFailure, EXIT_CODES, type FailureKind } from '../../failure.js';

import { z } from 'zod';
import { CloudApiError } from '@dexto/cloud-client';

import {
    argument,
    flag,
    MissingScopeFailure,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import {
    findLocalChats,
    type LocalChatQuery,
    type LocalChatScan,
} from '../../import/local-chats.js';
import { toImportInput, type ChatImportInput } from '../../import/redaction.js';
import {
    LOCAL_CHAT_SOURCES,
    type LocalChat,
    type LocalChatSource,
} from '../../import/transcript.js';
import { queryWorkspaceTool } from './workspace.js';

const FIND_OPTIONS = {
    dir: {
        description:
            'Read sessions from this folder (default: $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects; $CODEX_HOME/sessions or ~/.codex/sessions).',
        type: 'string',
        valueName: 'PATH',
    },
    from: {
        description: `Where the chats are: ${LOCAL_CHAT_SOURCES.join(' or ')}.`,
        type: 'string',
        valueName: 'SOURCE',
    },
    folder: {
        description:
            'Only sessions run in this folder or inside it, such as . for this repository.',
        type: 'string',
        valueName: 'PATH',
    },
    since: {
        description: 'Only sessions with a turn on or after this date, such as 2026-10-01.',
        type: 'string',
        valueName: 'DATE',
    },
} as const satisfies Record<string, OptionSpec>;

const ImportedSchema = z.object({
    session: z.object({ id: z.string() }),
    status: z.enum(['already_imported', 'imported']),
    url: z.string(),
});

function localQuery(input: CommandInput): LocalChatQuery {
    const from = stringOption(input, 'from');
    if (from === undefined)
        throw new UsageError(`--from is required: ${LOCAL_CHAT_SOURCES.join(' or ')}.`);
    const source = LOCAL_CHAT_SOURCES.find((each) => each === from);
    if (source === undefined)
        throw new UsageError(`--from takes ${LOCAL_CHAT_SOURCES.join(' or ')}, not ${from}.`);
    const since = stringOption(input, 'since') ?? null;
    if (since !== null && Number.isNaN(new Date(since).getTime()))
        throw new UsageError('--since must be a date, such as 2026-10-01.');
    return {
        dir: stringOption(input, 'dir') ?? null,
        folder: stringOption(input, 'folder') ?? null,
        since,
        source,
    };
}

function sourceName(source: LocalChatSource): string {
    return source === 'claude-code' ? 'Claude Code' : 'Codex';
}

const local: Command = {
    options: FIND_OPTIONS,
    path: ['chat', 'local'],
    summary:
        'List Claude Code or Codex chats on this machine, newest first, to pick some for chat import.',
    async run(context, input) {
        const scan = await findLocalChats(context.runtime, localQuery(input));
        noteScan(context, scan);
        context.output.list(
            {
                data: scan.chats.map((chat) => ({
                    cwd: chat.cwd,
                    id: chat.id,
                    messages: chat.messages.length,
                    path: chat.path,
                    pullRequests: chat.pullRequests,
                    repository: chat.repository,
                    source: chat.source,
                    startedAt: chat.startedAt,
                    title: chat.title,
                    updatedAt: chat.updatedAt,
                })),
            },
            [
                { header: 'id', value: (row) => row.id },
                { header: 'title', value: (row) => row.title },
                { header: 'messages', value: (row) => row.messages },
                { header: 'updated', value: (row) => row.updatedAt },
                { header: 'folder', value: (row) => row.cwd },
            ]
        );
    },
};

interface SessionResult {
    readonly chatId?: string;
    readonly id: string;
    /** How many of the session's oldest messages were left out to fit the import's bounds. */
    readonly leftOut?: number;
    readonly messages?: number;
    readonly reason?: string;
    readonly redactions?: Readonly<Record<string, number>>;
    readonly status: 'already_imported' | 'failed' | 'imported' | 'ready' | 'skipped';
    readonly title?: string;
    readonly truncated?: number;
    readonly url?: string;
}

const importChats: Command = {
    arguments: '[session_ids...]',
    options: {
        ...FIND_OPTIONS,
        all: { description: 'Import every session chat local lists.', type: 'boolean' },
        'dry-run': {
            description: 'Send nothing; show what each import would send and what was redacted.',
            type: 'boolean',
        },
        ...YES_OPTION,
    },
    path: ['chat', 'import'],
    summary:
        'Import Claude Code or Codex chats from this machine as your private Dexto chats, redacted here first.',
    async run(context, input) {
        const query = localQuery(input);
        const ids = input.positionals;
        const all = flag(input, 'all');
        if (ids.length === 0 && !all)
            throw new UsageError(
                'Name the sessions to import, by the ids chat local lists, or pass --all.'
            );
        const scan = await findLocalChats(context.runtime, query);
        noteScan(context, scan);
        const found = scan.chats;
        const planned = (
            all ? found : ids.map((id) => found.find((chat) => chat.id === id) ?? id)
        ).map((chat) => plan(chat, query.source));
        const sending = planned.filter((each) => each.input !== null);
        if (flag(input, 'dry-run') || sending.length === 0) {
            report(
                context,
                planned.map((each) => each.result)
            );
            return flag(input, 'dry-run') || planned.length === 0 ? 0 : 1;
        }
        const messages = sending.reduce((sum, each) => sum + (each.result.messages ?? 0), 0);
        const redacted = sending.reduce(
            (sum, each) =>
                sum + Object.values(each.result.redactions ?? {}).reduce((one, n) => one + n, 0),
            0
        );
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Upload ${sending.length} ${sourceName(query.source)} chat${sending.length === 1 ? '' : 's'} (${messages} messages, ${redacted} secrets redacted) as your private Dexto chats?`
        );

        const finished = await Promise.all(
            planned.map(async ({ input: sent, result }): Promise<SessionResult> => {
                if (sent === null) return result;
                try {
                    const imported = ImportedSchema.parse(
                        await queryWorkspaceTool(context, 'dexto_chat_import', sent)
                    );
                    return {
                        ...result,
                        chatId: imported.session.id,
                        status: imported.status,
                        url: imported.url,
                    };
                } catch (error) {
                    // A missing permission fails every import alike: exit 3 with the sign-in that fixes it.
                    if (error instanceof MissingScopeFailure) throw error;
                    return {
                        ...result,
                        reason: error instanceof Error ? error.message : 'The import failed.',
                        status: 'failed',
                    };
                }
            })
        );
        report(context, finished);
        return finished.some((result) => result.status === 'failed' || result.status === 'skipped')
            ? 1
            : 0;
    },
};

/** What importing one chosen session would send, or why it can't go. */
function plan(
    chat: LocalChat | string,
    source: LocalChatSource
): { input: ChatImportInput | null; result: SessionResult } {
    if (typeof chat === 'string')
        return {
            input: null,
            result: {
                id: chat,
                reason: `No ${sourceName(source)} session with this id matches here.`,
                status: 'skipped',
            },
        };
    const prepared = toImportInput(chat);
    if (prepared.kind === 'skipped')
        return {
            input: null,
            result: { id: chat.id, reason: prepared.reason, status: 'skipped', title: chat.title },
        };
    return {
        input: prepared.input,
        result: {
            id: chat.id,
            leftOut: prepared.leftOut,
            messages: prepared.input.messages.length,
            redactions: prepared.redactions,
            status: 'ready',
            title: prepared.input.title,
            truncated: prepared.truncated,
        },
    };
}

/** What the scan found that its chats don't show, such as Codex history it can't read yet. */
function noteScan(context: CommandContext, scan: LocalChatScan): void {
    for (const notice of scan.notices) context.output.note(notice.message);
}

function report(context: CommandContext, sessions: readonly SessionResult[]): void {
    context.output.result(
        { sessions },
        sessions
            .map((session) =>
                [
                    `${session.status.padEnd(16)} ${session.id}`,
                    session.title === undefined ? '' : `  ${session.title}`,
                    session.url === undefined ? '' : `  ${session.url}`,
                    session.reason === undefined ? '' : `  ${session.reason}`,
                    session.status === 'ready' ? `  ${readyLine(session)}` : '',
                ].join('')
            )
            .join('\n')
    );
}

function readyLine(session: SessionResult): string {
    const redactions = Object.entries(session.redactions ?? {})
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ');
    return [
        `${session.messages ?? 0} messages`,
        redactions === '' ? 'nothing redacted' : `redacted ${redactions}`,
        session.truncated ? `${session.truncated} cut to size` : '',
        session.leftOut ? `first ${session.leftOut} left out` : '',
    ]
        .filter((part) => part !== '')
        .join('; ');
}

const ListComputersActionSchema = z.object({
    tool: z.literal('dexto_chat_computers_list'),
    arguments: z.object({}).strict(),
});
const ListProfilesActionSchema = z.object({
    tool: z.literal('dexto_chat_browser_profiles_list'),
    arguments: z.object({}).strict(),
});
const ChatStartRefusalSchema = z.discriminatedUnion('outcome', [
    z.object({
        outcome: z.enum(['computer_not_found', 'computer_offline']),
        nextAction: ListComputersActionSchema,
    }),
    z.object({
        outcome: z.enum(['computer_incompatible', 'feature_denied']),
        nextAction: z.null(),
    }),
    z.object({
        outcome: z.enum(['profile_not_found', 'profile_busy', 'profile_unavailable']),
        nextAction: ListProfilesActionSchema,
    }),
]);
const StartedChatSchema = z.object({
    session: z
        .object({
            id: z.string(),
            title: z.string().nullable(),
            url: z.string(),
            status: z.string(),
        })
        .passthrough(),
});
const ChatStartResultSchema = z.union([StartedChatSchema, ChatStartRefusalSchema]);
const ComputersSchema = z
    .object({
        computers: z.array(
            z
                .object({
                    id: z.string(),
                    name: z.string(),
                    platform: z.string(),
                    presence: z.enum(['online', 'offline', 'unknown']),
                    compatible: z.boolean(),
                    feature: z.object({ enabled: z.boolean() }).passthrough(),
                })
                .passthrough()
        ),
    })
    .passthrough();
const BrowserProfilesSchema = z
    .object({
        profiles: z.array(
            z.object({ id: z.string(), name: z.string(), available: z.boolean() }).passthrough()
        ),
    })
    .passthrough();
const LOCATION_MESSAGES: Record<z.output<typeof ChatStartRefusalSchema>['outcome'], string> = {
    computer_not_found: 'That connected computer was not found.',
    computer_offline:
        'That connected computer is offline. Connect it or choose an online computer.',
    computer_incompatible: 'Update the connected computer runner before using it for a chat.',
    feature_denied:
        'Connected computers are not enabled for this account. Ask for access before selecting one.',
    profile_not_found: 'That browser profile was not found.',
    profile_busy: 'That browser profile is in use. Choose another or retry after its lease ends.',
    profile_unavailable: 'That browser profile cannot be used on this hosted computer.',
};

const FollowResultSchema = z
    .object({
        outcome: z.enum(['done', 'failed', 'cancelled', 'running', 'needs_input']),
        running: z.boolean(),
        cursor: z.string(),
        hasMore: z.boolean(),
        session: z.object({ id: z.string(), status: z.string().optional() }),
        nextAction: z
            .object({ instruction: z.string().optional() })
            .passthrough()
            .nullable()
            .optional(),
        events: z.array(z.unknown()),
        answer: z.string().nullable(),
        artifacts: z.array(z.unknown()),
        usage: z.record(z.string(), z.unknown()).nullable(),
    })
    .passthrough();

const FOLLOW_OPTIONS: Record<string, OptionSpec> = {
    timeout: {
        type: 'string',
        valueName: 'SECONDS',
        description:
            'Stop following after this many seconds; exit 6 if still running. Default: wait until finished.',
    },
};

function followDeadline(input: CommandInput): number {
    const timeout = stringOption(input, 'timeout');
    if (timeout === undefined) return Infinity;
    const seconds = Number(timeout);
    if (!Number.isFinite(seconds) || seconds < 0)
        throw new UsageError('--timeout must be a nonnegative number of seconds.');
    return Date.now() + seconds * 1000;
}

function readableChatEvent(event: unknown): string {
    const summary = z
        .object({
            type: z.string().optional(),
            sequence: z.number().optional(),
            payload: z.unknown().optional(),
        })
        .safeParse(event);
    if (!summary.success) return 'Chat update';
    const { type, sequence, payload } = summary.data;
    const text =
        typeof payload === 'object' &&
        payload !== null &&
        'text' in payload &&
        typeof payload.text === 'string'
            ? payload.text
            : '';
    return `${sequence === undefined ? '' : `${sequence} · `}${type ?? 'Chat update'}${text === '' ? '' : `: ${text}`}`;
}

async function followChat(
    context: CommandContext,
    sessionId: string,
    cursor: string | undefined,
    deadline: number,
    firstTool: 'dexto_chat_wait' | 'dexto_chat_follow' = 'dexto_chat_follow'
): Promise<number> {
    let tool = firstTool;
    let timedOut = false;
    let failures = 0;
    let retryBudgetMs = 30_000;
    try {
        for (;;) {
            context.runtime.signal.throwIfAborted();
            const remainingMs = Math.max(0, deadline - Date.now());
            const waitSeconds = Math.min(25, Math.ceil(remainingMs / 1000));
            const read = new AbortController();
            const onInterrupt = () => read.abort(context.runtime.signal.reason);
            context.runtime.signal.addEventListener('abort', onInterrupt, { once: true });
            let readTimedOut = false;
            // Bound stalled reads too, with a small transport grace beyond the server's budget.
            const timer = setTimeout(
                () => {
                    readTimedOut = true;
                    read.abort();
                },
                Math.min(remainingMs, waitSeconds * 1000 + 1_500)
            );
            let page: z.output<typeof FollowResultSchema>;
            try {
                page = FollowResultSchema.parse(
                    await queryWorkspaceTool(
                        { ...context, runtime: { ...context.runtime, signal: read.signal } },
                        tool,
                        { sessionId, ...(cursor === undefined ? {} : { cursor }), waitSeconds }
                    )
                );
            } catch (error) {
                context.runtime.signal.throwIfAborted();
                if (Date.now() >= deadline) {
                    timedOut = true;
                    throw error;
                }
                const transient =
                    error instanceof CloudApiError
                        ? error.status === 429 || (error.status >= 500 && error.status <= 599)
                        : error instanceof Error &&
                          !(error instanceof CommandFailure) &&
                          /network|connection|socket|fetch|ECONN|ETIMEDOUT/iu.test(error.message);
                if ((!readTimedOut && !transient) || failures >= 3) throw error;
                const delay = readTimedOut
                    ? 0
                    : Math.max(
                          500 * 2 ** failures,
                          error instanceof CloudApiError ? (error.retryAfterSeconds ?? 0) * 1000 : 0
                      );
                failures++;
                if (delay >= deadline - Date.now()) {
                    throw error;
                }
                if (delay > retryBudgetMs) throw error;
                retryBudgetMs -= delay;
                await context.runtime.sleep(delay);
                continue;
            } finally {
                clearTimeout(timer);
                context.runtime.signal.removeEventListener('abort', onInterrupt);
            }
            failures = 0;
            retryBudgetMs = 30_000;
            tool = 'dexto_chat_follow';
            for (const event of page.events) {
                if (context.output.json)
                    context.runtime.writeOutput(`${JSON.stringify({ type: 'event', event })}\n`);
                else context.runtime.writeOutput(`${readableChatEvent(event)}\n`);
            }
            cursor = page.cursor;
            if (
                page.outcome === 'needs_input' ||
                (!page.running && !page.hasMore) ||
                Date.now() >= deadline
            ) {
                const { events: _events, ...result } = page;
                if (context.output.json)
                    context.runtime.writeOutput(
                        `${JSON.stringify({ ...result, type: 'final' })}\n`
                    );
                else
                    context.output.result(
                        result,
                        `${page.answer ?? ''}\nArtifacts: ${JSON.stringify(page.artifacts)}\nUsage: ${JSON.stringify(page.usage)}\nOutcome: ${page.outcome}\n${page.nextAction?.instruction ?? ''}\nCursor: ${cursor}`
                    );
                return page.outcome === 'failed' || page.outcome === 'cancelled'
                    ? 1
                    : page.outcome === 'needs_input' || page.running || page.hasMore
                      ? 6
                      : 0;
            }
        }
    } catch (error) {
        // A read failure must never reach the outer grant-and-rerun path after a billable start.
        const interrupted = context.runtime.signal.aborted;
        const failure =
            error instanceof CommandFailure
                ? error
                : new CommandFailure(
                      'failed',
                      error instanceof Error ? error.message : 'Following the chat failed.',
                      null
                  );
        const result = {
            ...(interrupted
                ? { outcome: 'running', interrupted: true }
                : timedOut
                  ? { outcome: 'running', timedOut: true }
                  : {
                        outcome: 'error',
                        error: { kind: failure.kind, message: failure.message, fix: failure.fix },
                    }),
            session: { id: sessionId },
            cursor: cursor ?? null,
            nextAction: {
                tool: 'dexto_chat_follow',
                arguments: { sessionId, ...(cursor === undefined ? {} : { cursor }) },
            },
            type: 'final',
        };
        if (context.output.json) context.runtime.writeOutput(`${JSON.stringify(result)}\n`);
        else
            context.output.result(
                result,
                `Stopped following ${sessionId}.\n${interrupted ? 'Interrupted.' : timedOut ? 'Read deadline reached.' : failure.message}\n${interrupted || timedOut || failure.fix === null ? '' : `${failure.fix}\n`}Resume: dexto chat follow ${sessionId}${cursor === undefined ? '' : ` --cursor ${cursor}`}`
            );
        return interrupted ? 130 : timedOut ? 6 : EXIT_CODES[failure.kind];
    }
}

const follow: Command = {
    path: ['chat', 'follow'],
    arguments: '<id>',
    summary:
        'Follow durable cloud chat events until completion; Ctrl-C stops following without cancelling the chat.',
    options: {
        ...FOLLOW_OPTIONS,
        cursor: {
            type: 'string',
            valueName: 'CURSOR',
            description: 'Resume after a cursor returned by chat follow or start --wait.',
        },
    },
    run: (context, input) =>
        followChat(
            context,
            argument(input, 0, 'id'),
            stringOption(input, 'cursor'),
            followDeadline(input)
        ),
};

const start: Command = {
    path: ['chat', 'start'],
    arguments: '<message>',
    summary:
        'Start a cloud chat, optionally attaching your connected computer and choosing a browser profile.',
    options: {
        ...FOLLOW_OPTIONS,
        wait: {
            type: 'boolean',
            description: 'Wait for the answer, artifacts and usage; --json prints NDJSON.',
        },
        computer: {
            type: 'string',
            valueName: 'ID',
            description: 'An online connected computer from chat computers.',
        },
        'browser-profile': {
            type: 'string',
            valueName: 'ID',
            description:
                'An available browser profile from chat browser-profiles. Starts hosted compute.',
        },
        agent: {
            type: 'string',
            valueName: 'ID',
            description: 'Agent profile; omitted uses your Dexto.',
        },
        model: {
            type: 'string',
            valueName: 'ID',
            description: 'Model from workspace chat models.',
        },
        route: {
            type: 'string',
            valueName: 'ROUTE',
            description: 'Payment route for the chosen model.',
        },
        title: { type: 'string', valueName: 'TEXT', description: 'Short chat title.' },
        ...YES_OPTION,
    },
    async run(context, input) {
        const message = argument(input, 0, 'message');
        const deadline = followDeadline(input);
        const choices = Object.entries({
            computer: 'computerId',
            'browser-profile': 'browserProfileId',
            agent: 'agentId',
            model: 'model',
            route: 'route',
            title: 'title',
        });
        const args: Record<string, string | boolean> = { message };
        for (const [flagName, field] of choices) {
            const value = stringOption(input, flagName);
            if (value !== undefined) args[field] = value;
        }
        if (args.browserProfileId !== undefined || args.computerId !== undefined) {
            await requireConsent(
                {
                    invocation: context.invocation,
                    runtime: { prompt: context.output.json ? null : context.runtime.prompt },
                },
                flag(input, 'yes'),
                args.browserProfileId !== undefined
                    ? 'Start hosted compute billed to your account to load this browser profile?'
                    : 'Give this chat access to your connected computer?'
            );
            args.confirm = true;
        }
        // Start once. Subsequent bounded reads never retry a billable start.
        const raw = await queryWorkspaceTool(context, 'dexto_chat_start', args);
        if (flag(input, 'wait')) {
            const started = StartedChatSchema.safeParse(raw);
            if (started.success) {
                return followChat(
                    context,
                    started.data.session.id,
                    undefined,
                    deadline,
                    'dexto_chat_wait'
                );
            }
        }
        const parsed = ChatStartResultSchema.safeParse(raw);
        if (!parsed.success)
            throw new CommandFailure(
                'failed',
                "Dexto didn't return a valid chat start result.",
                null
            );
        const result = parsed.data;
        if ('outcome' in result) {
            const kind: FailureKind =
                result.outcome === 'computer_not_found' || result.outcome === 'profile_not_found'
                    ? 'not_found'
                    : result.outcome === 'feature_denied'
                      ? 'needs_permission'
                      : result.outcome === 'profile_busy' || result.outcome === 'computer_offline'
                        ? 'waiting_on_person'
                        : 'failed';
            const fix =
                result.nextAction === null
                    ? null
                    : result.nextAction.tool === 'dexto_chat_computers_list'
                      ? 'dexto chat computers'
                      : 'dexto chat browser-profiles';
            if (flag(input, 'wait')) {
                if (context.output.json)
                    context.runtime.writeOutput(
                        `${JSON.stringify({ ...result, type: 'final' })}\n`
                    );
                else
                    context.output.result(
                        result,
                        `${LOCATION_MESSAGES[result.outcome]}${fix === null ? '' : `\nNext: ${fix}`}`
                    );
                return EXIT_CODES[kind];
            }
            if (context.output.json) context.output.result(result, '');
            throw new CommandFailure(kind, LOCATION_MESSAGES[result.outcome], fix);
        }
        context.output.result(
            result,
            `Started ${result.session.title ?? result.session.id}\n${result.session.url}\nStatus: ${result.session.status}`
        );
        return 0;
    },
};

const computers: Command = {
    path: ['chat', 'computers'],
    summary: 'List your connected computers and their presence for chat start --computer.',
    async run(context) {
        const parsed = ComputersSchema.safeParse(
            await queryWorkspaceTool(context, 'dexto_chat_computers_list', {})
        );
        if (!parsed.success)
            throw new CommandFailure('failed', "Dexto didn't return a valid computer list.", null);
        const result = parsed.data;
        if (context.output.json) context.output.result(result, '');
        else
            context.output.list({ data: result.computers }, [
                { header: 'id', value: (row) => row.id },
                { header: 'name', value: (row) => row.name },
                { header: 'presence', value: (row) => row.presence },
                { header: 'compatible', value: (row) => (row.compatible ? 'yes' : 'no') },
                {
                    header: 'feature',
                    value: (row) => (row.feature.enabled ? 'enabled' : 'disabled'),
                },
            ]);
    },
};

const browserProfiles: Command = {
    path: ['chat', 'browser-profiles'],
    summary: 'List your browser profiles and availability for chat start --browser-profile.',
    async run(context) {
        const parsed = BrowserProfilesSchema.safeParse(
            await queryWorkspaceTool(context, 'dexto_chat_browser_profiles_list', {})
        );
        if (!parsed.success)
            throw new CommandFailure(
                'failed',
                "Dexto didn't return a valid browser profile list.",
                null
            );
        const result = parsed.data;
        if (context.output.json) context.output.result(result, '');
        else
            context.output.list({ data: result.profiles }, [
                { header: 'id', value: (row) => row.id },
                { header: 'name', value: (row) => row.name },
                { header: 'available', value: (row) => (row.available ? 'yes' : 'in use') },
            ]);
    },
};

export const chatCommands: readonly Command[] = [
    local,
    importChats,
    start,
    follow,
    computers,
    browserProfiles,
];
