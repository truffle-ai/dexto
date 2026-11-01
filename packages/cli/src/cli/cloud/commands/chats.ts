// `chat local` and `chat import`: find Claude Code and Codex chats on this machine and import them.

import { z } from 'zod';

import {
    flag,
    MissingScopeFailure,
    requireConsent,
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
    LOCAL_CHAT_SOURCES,
    toImportInput,
    type ChatImportInput,
    type LocalChat,
    type LocalChatQuery,
    type LocalChatSource,
} from '../local-chats.js';
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
        const chats = await findLocalChats(context.runtime, localQuery(input));
        context.output.list(
            {
                data: chats.map((chat) => ({
                    cwd: chat.cwd,
                    id: chat.id,
                    messages: chat.messages.length,
                    path: chat.path,
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
        const found = await findLocalChats(context.runtime, query);
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
            messages: prepared.input.messages.length,
            redactions: prepared.redactions,
            status: 'ready',
            title: prepared.input.title,
            truncated: prepared.truncated,
        },
    };
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
    ]
        .filter((part) => part !== '')
        .join('; ');
}

export const chatCommands: readonly Command[] = [local, importChats];
