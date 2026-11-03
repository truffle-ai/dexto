import { z } from 'zod';
import { findLocalChats } from '../../import/local-chats.js';
import { toImportInput, type ChatImportInput } from '../../import/redaction.js';
import { LOCAL_CHAT_SOURCES, type LocalChat } from '../../import/transcript.js';
import {
    flag,
    CommandFailure,
    requireConsent,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { queryWorkspaceTool } from './workspace.js';

const ImportedSchema = z.object({
    session: z.object({ id: z.string() }),
    status: z.enum(['imported', 'already_imported']),
    url: z.string(),
});

/** Boundary for the current text contract; native parts can replace this without changing selection. */
async function importTranscript(context: CommandContext, input: ChatImportInput) {
    return ImportedSchema.parse(await queryWorkspaceTool(context, 'dexto_chat_import', input));
}

const options = {
    select: {
        type: 'string',
        valueName: 'IDS',
        description: 'Comma-separated source:id values, or all.',
    },
    'current-session': {
        type: 'boolean',
        description: 'Select the current Claude Code or Codex session when its ID is available.',
    },
    'dry-run': { type: 'boolean', description: 'Preview redactions without uploading.' },
    ...YES_OPTION,
} as const;

function key(chat: LocalChat): string {
    return `${chat.source}:${chat.id}`;
}

async function runImport(
    context: CommandContext,
    input: CommandInput,
    listOnly: boolean
): Promise<number> {
    const selection = stringOption(input, 'select');
    const current = flag(input, 'current-session');
    if (selection !== undefined && current)
        throw new UsageError('Pass --select or --current-session, not both.');
    const codexId = current ? context.runtime.environment.CODEX_THREAD_ID : undefined;
    const claudeId = current ? context.runtime.environment.CLAUDE_CODE_SESSION_ID : undefined;
    if (codexId && claudeId)
        throw new UsageError(
            'Multiple current sessions are present. Select a source:id explicitly with --select.'
        );
    const currentKey = codexId ? `codex:${codexId}` : claudeId ? `claude-code:${claudeId}` : null;
    if (current && currentKey === null)
        throw new UsageError(
            'Cannot identify the current session. Select a source:id explicitly with --select.'
        );
    const scans = await Promise.all(
        LOCAL_CHAT_SOURCES.map((source) =>
            findLocalChats(context.runtime, { source, dir: null, folder: null, since: null })
        )
    );
    for (const scan of scans)
        for (const notice of scan.notices) context.output.note(notice.message);
    const chats = scans.flatMap((scan) => scan.chats);
    if (listOnly || (selection === undefined && !current)) {
        const sessions = chats.map((chat) => ({
            id: key(chat),
            source: chat.source,
            title: chat.title,
            cwd: chat.cwd,
            messages: chat.messages.length,
            updatedAt: chat.updatedAt,
        }));
        context.output.result(
            { sessions },
            sessions.map((item) => `${item.id} ${item.title}`).join('\n')
        );
        return 0;
    }
    const ids = currentKey
        ? [currentKey]
        : selection === 'all'
          ? chats.map(key)
          : (selection ?? '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean);
    if (ids.length === 0 || new Set(ids).size !== ids.length)
        throw new UsageError('Select one or more distinct source:id values, or all.');
    const chosen = ids.map((id) => {
        const chat = chats.find((item) => key(item) === id);
        if (chat === undefined)
            throw new UsageError(`Session ${id} was not found; run dexto import list --json.`);
        return chat;
    });
    const planned = chosen.map((chat) => ({ chat, prepared: toImportInput(chat) }));
    const preview = planned.map(({ chat, prepared }) =>
        prepared.kind === 'skipped'
            ? { id: key(chat), status: 'skipped', reason: prepared.reason }
            : {
                  id: key(chat),
                  status: 'ready',
                  messages: prepared.input.messages.length,
                  redactions: prepared.redactions,
                  truncated: prepared.truncated,
                  leftOut: prepared.leftOut,
              }
    );
    if (flag(input, 'dry-run')) {
        const sessions = preview.map((item, index) => {
            const prepared = planned[index]?.prepared;
            return prepared?.kind === 'ready' ? { ...item, payload: prepared.input } : item;
        });
        context.output.result({ sessions }, JSON.stringify(sessions, null, 2));
        return 0;
    }
    if (planned.some(({ prepared }) => prepared.kind === 'skipped')) {
        context.output.result({ sessions: preview }, JSON.stringify(preview, null, 2));
        return 1;
    }
    await requireConsent(
        context,
        flag(input, 'yes'),
        `Upload ${chosen.length} locally redacted chats to Dexto?`
    );
    const results = [];
    for (const { chat, prepared } of planned) {
        if (prepared.kind !== 'ready') continue;
        try {
            const result = await importTranscript(context, prepared.input);
            results.push({ id: key(chat), ...result });
        } catch (error) {
            if (error instanceof CommandFailure) throw error;
            results.push({ id: key(chat), status: 'failed', reason: 'Import failed.' });
        }
    }
    context.output.result({ sessions: results }, JSON.stringify(results, null, 2));
    return results.some((result) => result.status === 'failed') ? 1 : 0;
}

const discover: Command = {
    path: ['import'],
    options,
    summary: 'Discover or import local Claude Code and Codex chats.',
    run: (context, input) => runImport(context, input, false),
};
const list: Command = {
    path: ['import', 'list'],
    summary: 'List local chats for import.',
    run: (context, input) => runImport(context, input, true),
};
export const importCommands: readonly Command[] = [discover, list];
