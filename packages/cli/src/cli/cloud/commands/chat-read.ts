// Read your cloud chats: list or search them, read one's messages, and see the models a chat can use.
// list and history also read this machine's chats with --local.

import { z } from 'zod';
import type { DextoAgent } from '@dexto/core';
import { formatHistoryMessage } from '../../commands/helpers/formatters.js';
import { CommandFailure } from '../../failure.js';
import { shellWord } from '../../interaction.js';
import {
    argument,
    choiceOption,
    flag,
    PAGE_OPTIONS,
    pageQuery,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const CHAT_STATUSES = ['queued', 'running', 'retrying', 'waiting_approval', 'idle'] as const;
const IMPORT_SOURCES = ['claude_code', 'codex', 'claude_export', 'any'] as const;

const ChatSchema = z
    .object({
        id: z.string(),
        title: z.string().nullable(),
        status: z.string(),
        updatedAt: z.string(),
        url: z.string(),
        lastRun: z.object({ id: z.string(), status: z.string() }).passthrough().nullable(),
    })
    .passthrough();
// A search (--query) answers with no pagination: it returns its best matches only.
const ChatListSchema = z
    .object({
        sessions: z.array(ChatSchema),
        pagination: z.object({ nextCursor: z.string().nullable() }).passthrough().optional(),
    })
    .passthrough();
const ChatPageSchema = z
    .object({
        session: ChatSchema,
        messages: z.array(
            z.object({ role: z.string(), text: z.string(), createdAt: z.string() }).passthrough()
        ),
        pagination: z.object({ nextCursor: z.string().nullable() }).passthrough(),
    })
    .passthrough();
const ChatModelsSchema = z.object({
    models: z.array(
        z
            .object({
                id: z.string(),
                name: z.string(),
                current: z.boolean(),
                routes: z.array(z.string()),
            })
            .passthrough()
    ),
});

/** --limit and --after as the tools' limit (capped at 50) and cursor. */
function pageArgs(input: CommandInput): { limit?: number; cursor?: string } {
    const { after, limit } = pageQuery(input);
    if (limit !== undefined && (limit < 1 || limit > 50))
        throw new UsageError('--limit must be between 1 and 50.');
    return {
        ...(limit === undefined ? {} : { limit }),
        ...(after === undefined ? {} : { cursor: after }),
    };
}

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

/** The agent that holds this machine's chats; only dexto itself can open it. */
export async function openLocalChats(context: CommandContext): Promise<DextoAgent> {
    if (context.openLocalAgent === undefined)
        throw new CommandFailure(
            'failed',
            "This machine's chats are read only by dexto itself.",
            null
        );
    return context.openLocalAgent();
}

/**
 * A chat id the side it was looked up on doesn't have, pointing to the other side: a cloud miss to
 * --local, a --local miss to the cloud chat.
 */
export function chatNotFound(verb: 'history' | 'delete', sessionId: string, local: boolean) {
    const where = local ? 'on this machine' : 'in Dexto Cloud';
    const other = `dexto chat ${verb} ${shellWord(sessionId)}${local ? '' : ' --local'}`;
    return new CommandFailure(
        'not_found',
        `You have no chat ${sessionId} ${where}. For a chat ${local ? 'in Dexto Cloud' : 'on this machine'}, run: ${other}`,
        other
    );
}

/** This machine's chats, from the local agent's session store, most recently active first. */
async function listLocalChats(context: CommandContext, input: CommandInput): Promise<void> {
    const cloudOption = Object.keys(list.options ?? {}).find(
        (name) => name !== 'local' && input.values[name] !== undefined
    );
    if (cloudOption !== undefined)
        throw new UsageError(`--local lists every chat on this machine; drop --${cloudOption}.`);
    const agent = await openLocalChats(context);
    const chats = (
        await Promise.all(
            (await agent.listSessions()).map(async (id) => {
                const metadata = await agent.getSessionMetadata(id);
                return metadata === undefined ? [] : [{ id, metadata }];
            })
        )
    )
        .flat()
        .sort((a, b) => b.metadata.lastActivity - a.metadata.lastActivity)
        .map(({ id, metadata }) => ({
            id,
            title: metadata.title ?? null,
            messages: metadata.messageCount,
            lastActivity: new Date(metadata.lastActivity).toISOString(),
        }));
    context.output.list({ data: chats }, [
        { header: 'id', value: (chat) => chat.id },
        { header: 'title', value: (chat) => chat.title ?? '' },
        { header: 'messages', value: (chat) => chat.messages },
        { header: 'last active', value: (chat) => chat.lastActivity },
    ]);
    if (!context.output.json && chats.length > 0)
        context.output.note('Resume one with: dexto -r "$CHAT_ID"');
}

/**
 * Points people who knew chat list as this machine's chats to --local. Only for people: --json
 * never opens the local agent, and a machine without a usable one just gets no hint.
 */
async function noteLocalChats(context: CommandContext): Promise<void> {
    if (context.openLocalAgent === undefined) return;
    let count: number;
    try {
        count = (await (await context.openLocalAgent()).listSessions()).length;
    } catch {
        return;
    }
    if (count > 0)
        context.output.note(
            `This machine also has ${count} local chat${count === 1 ? '' : 's'}: dexto chat list --local`
        );
}

const list: Command = {
    path: ['chat', 'list'],
    summary:
        "List your cloud chats, newest first, or search them with --query (sessions:read); --local lists this machine's chats.",
    options: {
        status: {
            type: 'string',
            valueName: 'STATUS',
            description: `Only chats with this status: ${CHAT_STATUSES.join(', ')}. idle means no active run.`,
        },
        query: {
            type: 'string',
            valueName: 'WORDS',
            description:
                'Only chats whose title or messages contain every word, with where it matched.',
        },
        'imported-from': {
            type: 'string',
            valueName: 'SOURCE',
            description: `Only chats imported from ${IMPORT_SOURCES.join(', ')}.`,
        },
        ...PAGE_OPTIONS,
        local: {
            type: 'boolean',
            description: "List this machine's chats instead, to resume with dexto -r.",
        },
    },
    examples: [
        'dexto chat list --json',
        'dexto chat list --local',
        'dexto chat list --status running',
        'dexto chat list --query "invoice bug" --json',
        'dexto chat list --limit 10 --after "$CURSOR" --json',
    ],
    async run(context, input) {
        if (flag(input, 'local')) return listLocalChats(context, input);
        const status = choiceOption(input, 'status', CHAT_STATUSES);
        const importedFrom = choiceOption(input, 'imported-from', IMPORT_SOURCES);
        const query = stringOption(input, 'query');
        const page = pageArgs(input);
        if (query !== undefined && page.cursor !== undefined)
            throw new UsageError('--after does not page a --query search; drop one of them.');
        const args = {
            ...(status === undefined ? {} : { status }),
            ...(importedFrom === undefined ? {} : { importedFrom }),
            ...(query === undefined ? {} : { query }),
            ...page,
        };
        await requireLoginScopes(context, ['sessions:read']);
        const result = parsed(
            ChatListSchema,
            await queryWorkspaceTool(context, 'dexto_chat_list', args),
            'chat list'
        );
        const next = result.pagination?.nextCursor ?? null;
        context.output.list({ data: result.sessions, has_more: next !== null, next_after: next }, [
            { header: 'id', value: (chat) => chat.id },
            { header: 'title', value: (chat) => chat.title ?? '' },
            { header: 'status', value: (chat) => chat.status },
            { header: 'last run', value: (chat) => chat.lastRun?.status ?? '' },
            { header: 'updated', value: (chat) => chat.updatedAt },
        ]);
        if (!context.output.json) await noteLocalChats(context);
    },
};

const get: Command = {
    path: ['chat', 'get'],
    arguments: '<chat_id>',
    summary:
        'Read a cloud chat: its status, how its last run ended and its latest messages. Requires sessions:read.',
    options: {
        limit: {
            type: 'string',
            valueName: 'N',
            description: 'How many messages (1-50; default 20).',
        },
        after: {
            type: 'string',
            valueName: 'CURSOR',
            description: 'Read the messages before this cursor, from the previous page.',
        },
    },
    examples: [
        'dexto chat get "$CHAT_ID"',
        'dexto chat get "$CHAT_ID" --limit 50 --json',
        'dexto chat get "$CHAT_ID" --after "$CURSOR" --json',
    ],
    async run(context, input) {
        const sessionId = argument(input, 0, 'chat_id');
        const args = { sessionId, ...pageArgs(input) };
        await requireLoginScopes(context, ['sessions:read']);
        const page = await readChatPage(context, args);
        const lines = chatLines(page);
        if (page.pagination.nextCursor !== null)
            lines.push(
                '',
                `Older messages: dexto chat get ${sessionId} --after ${page.pagination.nextCursor}`
            );
        context.output.result(page, lines.join('\n'));
    },
};

async function readChatPage(
    context: CommandContext,
    args: { sessionId: string; limit?: number; cursor?: string }
): Promise<z.output<typeof ChatPageSchema>> {
    return parsed(
        ChatPageSchema,
        await queryWorkspaceTool(context, 'dexto_chat_get', args),
        'chat'
    );
}

/** A chat's title, link, status and messages, as a person reads them. */
function chatLines({
    session,
    messages,
}: Pick<z.output<typeof ChatPageSchema>, 'session' | 'messages'>): string[] {
    return [
        session.title ?? session.id,
        session.url,
        `Status: ${session.status}${session.lastRun === null ? '' : `; last run ${session.lastRun.status}`}`,
        ...messages.flatMap((message) => [
            '',
            `${message.role}, ${message.createdAt}`,
            message.text,
        ]),
    ];
}

/** Every message of a chat on this machine, read from the local agent's session store. */
async function localHistory(context: CommandContext, sessionId: string): Promise<void> {
    const agent = await openLocalChats(context);
    if ((await agent.getSessionMetadata(sessionId)) === undefined)
        throw chatNotFound('history', sessionId, true);
    const messages = await agent.getSessionHistory(sessionId);
    context.output.result(
        { sessionId, messages },
        messages.length === 0
            ? `Chat ${sessionId} has no messages yet.`
            : messages.map(formatHistoryMessage).join('\n')
    );
}

const history: Command = {
    path: ['chat', 'history'],
    arguments: '<chat_id>',
    summary:
        "Read every message of a cloud chat, oldest first (sessions:read); --local reads a chat on this machine. dexto chat get reads one page with the chat's status.",
    options: {
        local: {
            type: 'boolean',
            description: 'Read a chat on this machine instead, from dexto chat list --local.',
        },
    },
    examples: [
        'dexto chat history "$CHAT_ID"',
        'dexto chat history "$CHAT_ID" --json',
        'dexto chat history "$CHAT_ID" --local --json',
    ],
    async run(context, input) {
        const sessionId = argument(input, 0, 'chat_id');
        if (flag(input, 'local')) return localHistory(context, sessionId);
        await requireLoginScopes(context, ['sessions:read']);
        // Each page is in order and pages go back in time, so older pages go in front.
        let page = await readChatPage(context, { sessionId, limit: 50 }).catch((error: unknown) => {
            if (error instanceof CommandFailure && error.kind === 'not_found')
                throw chatNotFound('history', sessionId, false);
            throw error;
        });
        const session = page.session;
        let messages = page.messages;
        while (page.pagination.nextCursor !== null) {
            page = await readChatPage(context, {
                sessionId,
                limit: 50,
                cursor: page.pagination.nextCursor,
            });
            messages = [...page.messages, ...messages];
        }
        context.output.result({ session, messages }, chatLines({ session, messages }).join('\n'));
    },
};

const models: Command = {
    path: ['chat', 'models'],
    summary:
        'List the models your chats can run on now and how each can be paid for; current is what a new chat uses. Requires sessions:read.',
    examples: ['dexto chat models', 'dexto chat models --json'],
    async run(context) {
        await requireLoginScopes(context, ['sessions:read']);
        const result = parsed(
            ChatModelsSchema,
            await queryWorkspaceTool(context, 'dexto_chat_models', {}),
            'model list'
        );
        context.output.list({ data: result.models }, [
            { header: 'id', value: (model) => model.id },
            { header: 'name', value: (model) => model.name },
            { header: 'routes', value: (model) => model.routes.join(', ') },
            { header: 'current', value: (model) => (model.current ? 'yes' : '') },
        ]);
    },
};

export const chatReadCommands: readonly Command[] = [list, get, history, models];
