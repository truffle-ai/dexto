// Finds the Claude Code and Codex chats on this machine that a query asks for.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { UsageError } from '../cloud/command.js';
import type { CloudRuntime } from '../cloud/runtime.js';
import { claudeCodeFolder, parseClaudeCodeTranscript } from './claude-code.js';
import { codexHome, parseCodexRollout, readCodexThreads, type CodexThread } from './codex.js';
import { createRepositoryFinder, withoutCredentials } from './git.js';
import type { LocalChat, LocalChatSource, ParsedChat } from './transcript.js';

/** A transcript file larger than this is not read. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface LocalChatQuery {
    /** Another sessions folder to read instead of the source's own. */
    readonly dir: string | null;
    /** Keep sessions whose working directory is this folder or inside it. */
    readonly folder: string | null;
    /** Keep sessions with a turn at or after this date. */
    readonly since: string | null;
    readonly source: LocalChatSource;
}

/** Something about this machine's sessions that the chats found don't show. */
export interface LocalChatNotice {
    readonly code: 'codex_history_migrated';
    /** How many sessions it is about. */
    readonly count: number;
    readonly message: string;
}

export interface LocalChatScan {
    /** Newest first. */
    readonly chats: readonly LocalChat[];
    readonly notices: readonly LocalChatNotice[];
}

type FinderRuntime = Pick<CloudRuntime, 'environment' | 'homeDirectory'>;

/** The source's sessions on this machine that match the query, newest first. */
export async function findLocalChats(
    runtime: FinderRuntime,
    query: LocalChatQuery
): Promise<LocalChatScan> {
    if (query.dir !== null)
        await readdir(query.dir).catch(() => {
            throw new UsageError(`--dir ${query.dir} is not a folder this can read.`);
        });
    const since = query.since === null ? null : new Date(query.since);
    const within = query.folder === null ? null : path.resolve(query.folder);
    const matches = (updatedAt: string, cwd: string | null) =>
        (since === null || new Date(updatedAt) >= since) &&
        (within === null || insideFolder(cwd, within));

    const sessions =
        query.source === 'claude-code'
            ? await claudeCodeSessions(runtime, query.dir)
            : await codexSessions(runtime, query.dir);
    const repositoryOf = createRepositoryFinder();
    const chats: LocalChat[] = [];
    for (const file of sessions.files) {
        const stats = await stat(file).catch(() => null);
        if (stats === null || stats.size > MAX_FILE_BYTES) continue;
        const parsed = sessions.parse(await readFile(file, 'utf8'), file);
        if (parsed === null || !matches(parsed.updatedAt, parsed.cwd)) continue;
        chats.push(await withRepository(parsed, repositoryOf));
    }
    const notices = sessions.notices(matches);
    return {
        chats: chats.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        notices,
    };
}

interface SourceSessions {
    readonly files: readonly string[];
    readonly notices: (
        matches: (updatedAt: string, cwd: string | null) => boolean
    ) => LocalChatNotice[];
    readonly parse: (text: string, file: string) => ParsedChat | null;
}

async function claudeCodeSessions(
    runtime: FinderRuntime,
    dir: string | null
): Promise<SourceSessions> {
    const folder = dir ?? claudeCodeFolder(runtime.environment, runtime.homeDirectory);
    return {
        files: await claudeCodeFiles(folder),
        notices: () => [],
        parse: parseClaudeCodeTranscript,
    };
}

/**
 * Codex rollouts, titled as Codex lists them. Its own state database is read only for its own
 * sessions folder: a `--dir` is a copy, whose threads that database doesn't describe.
 */
async function codexSessions(runtime: FinderRuntime, dir: string | null): Promise<SourceSessions> {
    const home = codexHome(runtime.environment, runtime.homeDirectory);
    const threads = dir === null ? await readCodexThreads(home) : null;
    const titles = new Map((threads ?? []).map((thread) => [thread.id, thread.title]));
    return {
        files: await codexFiles(dir ?? path.join(home, 'sessions')),
        notices: (matches) => migratedNotice(threads ?? [], matches),
        parse: (text, file) => parseCodexRollout(text, file, (id) => titles.get(id) ?? null),
    };
}

/** Codex threads whose history moved out of rollout files, which this can't read yet. */
function migratedNotice(
    threads: readonly CodexThread[],
    matches: (updatedAt: string, cwd: string | null) => boolean
): LocalChatNotice[] {
    const count = threads.filter(
        (thread) => !thread.hasRollout && matches(thread.updatedAt, thread.cwd)
    ).length;
    if (count === 0) return [];
    const chats = count === 1 ? '1 Codex chat has' : `${count} Codex chats have`;
    return [
        {
            code: 'codex_history_migrated',
            count,
            message: `${chats} no rollout file on this machine, so it can't be imported yet: Codex keeps its history in its own database after \`codex migrate-rollouts\`.`,
        },
    ];
}

async function withRepository(
    parsed: ParsedChat,
    repositoryOf: ReturnType<typeof createRepositoryFinder>
): Promise<LocalChat> {
    const { recordedRemoteUrl, ...chat } = parsed;
    const onDisk = await repositoryOf(chat.cwd);
    // The remote Codex recorded when the session ran outlives a checkout that has since moved.
    const remoteUrl =
        recordedRemoteUrl === null
            ? (onDisk?.remoteUrl ?? null)
            : withoutCredentials(recordedRemoteUrl);
    const root = onDisk?.root ?? null;
    return {
        ...chat,
        repository: root === null && remoteUrl === null ? null : { remoteUrl, root },
    };
}

function insideFolder(cwd: string | null, folder: string): boolean {
    if (cwd === null) return false;
    const relative = path.relative(folder, cwd);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function entries(folder: string) {
    return await readdir(folder, { withFileTypes: true }).catch(() => []);
}

/** `projects/<project>/<session>.jsonl`; deeper files are a session's subagents. */
async function claudeCodeFiles(folder: string): Promise<string[]> {
    const files: string[] = [];
    for (const project of await entries(folder)) {
        if (!project.isDirectory()) continue;
        for (const file of await entries(path.join(folder, project.name)))
            if (file.isFile() && file.name.endsWith('.jsonl'))
                files.push(path.join(folder, project.name, file.name));
    }
    return files;
}

/** `sessions/YYYY/MM/DD/rollout-*.jsonl`; compressed rollouts are left out. */
async function codexFiles(folder: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (dir: string, depth: number) => {
        for (const entry of await entries(dir)) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory() && depth < 3) await visit(full, depth + 1);
            else if (
                entry.isFile() &&
                entry.name.startsWith('rollout-') &&
                entry.name.endsWith('.jsonl')
            )
                files.push(full);
        }
    };
    await visit(folder, 0);
    return files;
}
