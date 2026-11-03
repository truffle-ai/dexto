import { findLocalChats } from '../../import/local-chats.js';
import { findPersonalSkills } from '../../import/personal-skills.js';
import { redactSecrets, toImportInput } from '../../import/redaction.js';
import { LOCAL_CHAT_SOURCES, type LocalChat } from '../../import/transcript.js';
import { CommandFailure, EXIT_CODES } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    flag,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { sendTranscript } from './import-client.js';

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
    if (
        selection?.split(',').some((id) => id.trim().startsWith('skill:')) ||
        (selection === 'all' &&
            (await findPersonalSkills(context.runtime.homeDirectory, context.runtime.environment))
                .length > 0)
    )
        throw new UsageError(
            'Personal skill import is not available yet. Select chat IDs explicitly.'
        );
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
        const personalSkills = await findPersonalSkills(
            context.runtime.homeDirectory,
            context.runtime.environment
        );
        const skills = personalSkills.map((skill) => {
            const name = redactSecrets(skill.name).text;
            return {
                id: `skill:${skill.source}:${name}`,
                source: skill.source,
                name,
                status: 'not_available' as const,
            };
        });
        const sessions = chats.map((chat) => ({
            id: key(chat),
            source: chat.source,
            title: redactSecrets(chat.title).text,
            cwd: chat.cwd === null ? null : redactSecrets(chat.cwd).text,
            messages: chat.messages.length,
            updatedAt: chat.updatedAt,
        }));
        context.output.result(
            { sessions, skills },
            [
                ...sessions.map((item) => `${item.id} ${item.title}`),
                ...skills.map((item) => `${item.id} (import not available yet)`),
            ].join('\n')
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
    if (ids.length === 0 && selection === 'all') {
        context.output.result({ sessions: [] }, 'No local sessions found.');
        return 0;
    }
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
        return planned.some(({ prepared }) => prepared.kind === 'skipped') ? 1 : 0;
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
    for (const [index, { chat, prepared }] of planned.entries()) {
        if (prepared.kind !== 'ready') continue;
        try {
            const result = await sendTranscript(context, { kind: 'text', input: prepared.input });
            results.push({ id: key(chat), ...result });
        } catch (error) {
            if (
                error instanceof CommandFailure &&
                (error.kind === 'needs_sign_in' || error.kind === 'needs_permission')
            ) {
                if (results.length === 0) throw error;
                results.push({
                    id: key(chat),
                    status: 'failed',
                    reason: 'Sign-in or permission required.',
                });
                for (const remaining of planned.slice(index + 1))
                    results.push({
                        id: key(remaining.chat),
                        status: 'not_attempted',
                        reason: 'Sign-in or permission required.',
                    });
                const report = {
                    sessions: results,
                    error: {
                        code: error.kind,
                        message: 'Sign-in or permission required.',
                        ...(error.fix === null ? {} : { fix: error.fix }),
                    },
                };
                context.output.result(report, JSON.stringify(report, null, 2));
                return EXIT_CODES[error.kind];
            }
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
