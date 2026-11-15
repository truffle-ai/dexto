// Reads Codex sessions: rollouts in `$CODEX_HOME/sessions/YYYY/MM/DD/`, titled from `state_5.sqlite`.

import { access } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
    answeredBy,
    createTurns,
    finishChat,
    isRecord,
    jsonLines,
    stringField,
    toolCallText,
    toolResultText,
    validTime,
    type AnsweredBy,
    type ParsedChat,
} from './transcript.js';

/** Context Codex sends as `user` messages that the person never typed. */
const CODEX_INJECTED =
    /^\s*(<environment_context>|<user_instructions>|<permissions instructions>|<turn_aborted>|# AGENTS\.md instructions)/u;

/**
 * A Codex rollout: `{timestamp, type, payload}` lines, as `codex-rs/history` writes them. The
 * `session_meta` line names the thread and its git remote; `response_item` lines carry messages and
 * tool calls. Developer and system messages, injected context, reasoning and compaction are left out.
 * Each `turn_context` line names the model and effort for the turns after it, until the next one.
 * `titleOf` gives the title Codex keeps for a thread, or null when it keeps none.
 */
export function parseCodexRollout(
    text: string,
    file: string,
    titleOf: (threadId: string) => string | null
): ParsedChat | null {
    const turns = createTurns();
    let id: string | null = null;
    let cwd: string | null = null;
    let gitBranch: string | null = null;
    let remoteUrl: string | null = null;
    let model: AnsweredBy | null = null;
    for (const line of jsonLines(text)) {
        const payload = line.payload;
        if (!isRecord(payload)) continue;
        if (line.type === 'session_meta') {
            id ??= stringField(payload, 'id');
            cwd ??= stringField(payload, 'cwd');
            if (isRecord(payload.git)) {
                gitBranch ??= stringField(payload.git, 'branch');
                remoteUrl ??= stringField(payload.git, 'repository_url');
            }
            continue;
        }
        if (line.type === 'turn_context') {
            model = answeredBy(payload.model, payload.effort);
            continue;
        }
        const at = validTime(stringField(line, 'timestamp'));
        if (line.type !== 'response_item' || at === null) continue;
        switch (payload.type) {
            case 'message': {
                const said = codexContentText(payload.content);
                if (payload.role === 'user' && !CODEX_INJECTED.test(said)) turns.user(said, at);
                if (payload.role === 'assistant') turns.assistant(said, at, model);
                break;
            }
            case 'function_call':
                turns.assistant(
                    toolCallText(stringField(payload, 'name') ?? 'tool', payload.arguments ?? ''),
                    at,
                    model
                );
                break;
            case 'custom_tool_call':
                turns.assistant(
                    toolCallText(stringField(payload, 'name') ?? 'tool', payload.input ?? ''),
                    at,
                    model
                );
                break;
            case 'local_shell_call': {
                const action = isRecord(payload.action) ? payload.action : {};
                const command = Array.isArray(action.command) ? action.command : [];
                turns.assistant(toolCallText('shell', { command }), at, model);
                break;
            }
            case 'function_call_output':
            case 'custom_tool_call_output':
                turns.assistant(toolResultText(codexOutputText(payload.output)), at, model);
                break;
        }
    }
    const threadId = id ?? path.basename(file, '.jsonl');
    return finishChat(
        {
            cwd,
            gitBranch,
            id: threadId,
            path: file,
            pullRequests: [],
            recordedRemoteUrl: remoteUrl,
            source: 'codex',
            title: titleOf(threadId),
        },
        turns.done()
    );
}

function codexContentText(content: unknown): string {
    if (!Array.isArray(content)) return '';
    return content
        .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
        .filter((part) => part !== '')
        .join('\n');
}

function codexOutputText(output: unknown): string {
    if (typeof output === 'string') return output;
    if (isRecord(output) && typeof output.content === 'string') return output.content;
    return codexContentText(output);
}

/** `$CODEX_HOME`, or `~/.codex`. */
export function codexHome(
    environment: Readonly<Record<string, string | undefined>>,
    homeDirectory: string
): string {
    return environment.CODEX_HOME ?? path.join(homeDirectory, '.codex');
}

// ---------------------------------------------------------------------------------------------
// state_5.sqlite
// ---------------------------------------------------------------------------------------------

/** A row of Codex's `threads` table, as much of it as an import needs. */
export interface CodexThread {
    readonly cwd: string;
    readonly id: string;
    /** Whether its rollout file is still on disk; `codex migrate-rollouts` moves history out. */
    readonly hasRollout: boolean;
    /** The name the person gave it, else the title Codex gave it; null when both are blank. */
    readonly title: string | null;
    readonly updatedAt: string;
}

/** The state database Codex 0.1xx keeps beside its rollouts. */
const CODEX_STATE_DB = 'state_5.sqlite';

const ThreadRowsSchema = z.array(
    z.object({
        archived: z.number(),
        cwd: z.string(),
        id: z.string(),
        name: z.string().nullable(),
        rollout_path: z.string().nullable(),
        title: z.string(),
        updated_at: z.number(),
    })
);

/**
 * The threads Codex lists, read from its state database without writing to it; null when there is
 * no such database. A present database that cannot be read is reported to the caller.
 * Archived threads are left out, as their rollouts are not where sessions are read from.
 */
export async function readCodexThreads(home: string): Promise<CodexThread[] | null> {
    const file = path.join(home, CODEX_STATE_DB);
    if (!(await exists(file))) return null;
    let rows: z.output<typeof ThreadRowsSchema>;
    try {
        // better-sqlite3, or the SQLite built into Node.js where it did not install.
        const { openSqlite } = await import('@dexto/storage');
        const db = await openSqlite(file, { fileMustExist: true, readonly: true, timeoutMs: 5000 });
        try {
            rows = ThreadRowsSchema.parse(
                db
                    .prepare(
                        'SELECT id, rollout_path, cwd, title, name, archived, updated_at FROM threads'
                    )
                    .all()
            );
        } finally {
            db.close();
        }
    } catch (error) {
        throw new Error(
            `Cannot read Codex state database; titles and migrated history are unavailable. Use --dir to read rollout files without it. ${error instanceof Error ? error.message : 'Unknown error.'}`,
            { cause: error }
        );
    }
    const threads: CodexThread[] = [];
    for (const row of rows) {
        if (row.archived !== 0) continue;
        const name = row.name?.trim() ?? '';
        const title = row.title.trim();
        threads.push({
            cwd: row.cwd,
            hasRollout: row.rollout_path !== null && (await exists(row.rollout_path)),
            id: row.id,
            title: name !== '' ? name : title !== '' ? title : null,
            updatedAt: new Date(row.updated_at * 1_000).toISOString(),
        });
    }
    return threads;
}

async function exists(file: string): Promise<boolean> {
    return await access(file).then(
        () => true,
        () => false
    );
}
