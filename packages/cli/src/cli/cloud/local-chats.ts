// Reads Claude Code and Codex chats on this machine into redacted, bounded turns to import.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { UsageError } from './command.js';
import type { CloudRuntime } from './runtime.js';

export type LocalChatSource = 'claude-code' | 'codex';
export const LOCAL_CHAT_SOURCES: readonly LocalChatSource[] = ['claude-code', 'codex'];

interface LocalChatMessage {
    readonly createdAt: string;
    readonly role: 'assistant' | 'user';
    readonly text: string;
}

export interface LocalChat {
    readonly cwd: string | null;
    readonly gitBranch: string | null;
    readonly id: string;
    readonly messages: readonly LocalChatMessage[];
    /** The transcript file it was read from. */
    readonly path: string;
    readonly source: LocalChatSource;
    readonly startedAt: string;
    readonly title: string;
    readonly updatedAt: string;
}

/** What `dexto_chat_import` takes; its bounds are the server's too. */
export interface ChatImportInput {
    readonly cwd?: string;
    readonly gitBranch?: string;
    readonly messages: readonly LocalChatMessage[];
    readonly source: LocalChatSource;
    readonly sourceSessionId: string;
    readonly title: string;
}

export const MAX_IMPORT_MESSAGES = 2_000;
export const MAX_MESSAGE_CHARS = 64_000;
const MAX_IMPORT_CHARS = 4_000_000;
const MAX_TITLE_CHARS = 200;
const MAX_CWD_CHARS = 1_024;
const MAX_BRANCH_CHARS = 255;
/** How much of one tool call's input or result an imported chat keeps. */
const MAX_TOOL_CHARS = 4_000;
/** A transcript file larger than this is not read. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const SOURCE_SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/u;

// ---------------------------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------------------------

/**
 * Collects turns as a chat shows them: each person's message, then one assistant message holding
 * everything the agent said and ran until the next one.
 */
function createTurns() {
    const messages: LocalChatMessage[] = [];
    let assistant: { createdAt: string; parts: string[] } | null = null;
    let lastAt: string | null = null;
    const flush = () => {
        if (assistant !== null && assistant.parts.length > 0)
            messages.push({
                createdAt: assistant.createdAt,
                role: 'assistant',
                text: assistant.parts.join('\n\n'),
            });
        assistant = null;
    };
    return {
        assistant(text: string, createdAt: string) {
            if (text.trim() === '') return;
            assistant ??= { createdAt, parts: [] };
            assistant.parts.push(text.trim());
            lastAt = createdAt;
        },
        /** The turns, and when the last thing in them happened. */
        done(): { lastAt: string | null; messages: LocalChatMessage[] } {
            flush();
            return { lastAt, messages };
        },
        user(text: string, createdAt: string) {
            if (text.trim() === '') return;
            flush();
            messages.push({ createdAt, role: 'user', text: text.trim() });
            lastAt = createdAt;
        },
    };
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const marker = `\n… [${text.length - max} more characters left out]`;
    return `${text.slice(0, Math.max(0, max - marker.length))}${marker}`;
}

/** Text in a fence no backtick run inside it can close. */
function fenced(text: string): string {
    const longest = Math.max(2, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}\n${text}\n${fence}`;
}

/** Redacted whole, then cut: a cut can leave a secret no pattern still matches. */
function toolBody(text: string): string {
    return fenced(truncate(redactSecrets(text).text, MAX_TOOL_CHARS));
}

function toolCallText(name: string, input: unknown): string {
    const body =
        typeof input === 'string' ? prettyJson(input) : JSON.stringify(input ?? null, null, 2);
    return `**Tool call: ${name}**\n${toolBody(body)}`;
}

function toolResultText(output: string): string {
    return `**Tool result**\n${toolBody(output)}`;
}

/** A JSON string pretty-printed, or as it is when it isn't JSON. */
function prettyJson(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

function firstLine(text: string): string {
    const line = text.split('\n').find((each) => each.trim() !== '') ?? '';
    return truncate(line.trim(), 80);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | null {
    const field = value[key];
    return typeof field === 'string' && field !== '' ? field : null;
}

/** Each line that is a JSON object; a torn or foreign line is left out. */
function jsonLines(text: string): Record<string, unknown>[] {
    return text.split('\n').flatMap((line) => {
        if (line.trim() === '') return [];
        try {
            const value: unknown = JSON.parse(line);
            return isRecord(value) ? [value] : [];
        } catch {
            return [];
        }
    });
}

function validTime(value: string | null): string | null {
    if (value === null) return null;
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function finishChat(
    fields: Omit<LocalChat, 'messages' | 'startedAt' | 'title' | 'updatedAt'> & {
        title: string | null;
    },
    { lastAt, messages }: { lastAt: string | null; messages: readonly LocalChatMessage[] }
): LocalChat | null {
    const first = messages[0];
    if (first === undefined || lastAt === null || !messages.some((m) => m.role === 'user'))
        return null;
    const firstUser = messages.find((message) => message.role === 'user');
    return {
        ...fields,
        messages,
        startedAt: first.createdAt,
        title: truncate(fields.title ?? firstLine(firstUser?.text ?? 'Imported chat'), 200),
        updatedAt: lastAt,
    };
}

// ---------------------------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------------------------

/** What Claude Code writes as a `user` line but the person never typed: slash commands and their output. */
const CLAUDE_CODE_INJECTED = /^\s*<(command-name|command-message|local-command-[a-z]+)>/u;

/**
 * A Claude Code session file: one Agent SDK message per line (`type` `user` or `assistant`, with
 * Anthropic `message.content`), plus `summary` lines that title it. Sidechain (subagent) and meta
 * lines are left out, as is thinking.
 */
export function parseClaudeCodeTranscript(text: string, file: string): LocalChat | null {
    const turns = createTurns();
    let sessionId: string | null = null;
    let cwd: string | null = null;
    let gitBranch: string | null = null;
    let title: string | null = null;
    for (const line of jsonLines(text)) {
        if (line.type === 'summary') {
            title ??= stringField(line, 'summary');
            continue;
        }
        if (line.type !== 'user' && line.type !== 'assistant') continue;
        if (line.isSidechain === true || line.isMeta === true) continue;
        const message = line.message;
        const at = validTime(stringField(line, 'timestamp'));
        if (!isRecord(message) || at === null) continue;
        sessionId ??= stringField(line, 'sessionId');
        cwd ??= stringField(line, 'cwd');
        gitBranch ??= stringField(line, 'gitBranch');
        const content = message.content;
        if (typeof content === 'string') {
            if (line.type === 'assistant') turns.assistant(content, at);
            else if (!CLAUDE_CODE_INJECTED.test(content)) turns.user(content, at);
            continue;
        }
        if (!Array.isArray(content)) continue;
        for (const block of content) {
            if (!isRecord(block)) continue;
            if (block.type === 'text' && typeof block.text === 'string') {
                if (line.type === 'assistant') turns.assistant(block.text, at);
                else if (!CLAUDE_CODE_INJECTED.test(block.text)) turns.user(block.text, at);
            } else if (block.type === 'tool_use') {
                turns.assistant(
                    toolCallText(stringField(block, 'name') ?? 'tool', block.input),
                    at
                );
            } else if (block.type === 'tool_result') {
                turns.assistant(toolResultText(claudeToolResultText(block.content)), at);
            } else if (block.type === 'image' && line.type === 'user') {
                turns.user('[An image was attached here; it was not imported.]', at);
            }
        }
    }
    const id = sessionId ?? path.basename(file, '.jsonl');
    return finishChat(
        { cwd, gitBranch, id, path: file, source: 'claude-code', title },
        turns.done()
    );
}

function claudeToolResultText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) =>
            isRecord(part) && typeof part.text === 'string'
                ? part.text
                : isRecord(part) && part.type === 'image'
                  ? '[image]'
                  : ''
        )
        .filter((part) => part !== '')
        .join('\n');
}

// ---------------------------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------------------------

/** Context Codex sends as `user` messages that the person never typed. */
const CODEX_INJECTED =
    /^\s*(<environment_context>|<user_instructions>|<permissions instructions>|<turn_aborted>|# AGENTS\.md instructions)/u;

/**
 * A Codex rollout: `{timestamp, type, payload}` lines, as `codex-rs/history` writes them. The
 * `session_meta` line names the thread; `response_item` lines carry messages and tool calls.
 * Developer and system messages, injected context and reasoning are left out.
 */
export function parseCodexRollout(text: string, file: string): LocalChat | null {
    const turns = createTurns();
    let id: string | null = null;
    let cwd: string | null = null;
    let gitBranch: string | null = null;
    for (const line of jsonLines(text)) {
        const payload = line.payload;
        if (!isRecord(payload)) continue;
        if (line.type === 'session_meta') {
            id ??= stringField(payload, 'id');
            cwd ??= stringField(payload, 'cwd');
            if (isRecord(payload.git)) gitBranch ??= stringField(payload.git, 'branch');
            continue;
        }
        const at = validTime(stringField(line, 'timestamp'));
        if (line.type !== 'response_item' || at === null) continue;
        switch (payload.type) {
            case 'message': {
                const said = codexContentText(payload.content);
                if (payload.role === 'user' && !CODEX_INJECTED.test(said)) turns.user(said, at);
                if (payload.role === 'assistant') turns.assistant(said, at);
                break;
            }
            case 'function_call':
                turns.assistant(
                    toolCallText(stringField(payload, 'name') ?? 'tool', payload.arguments ?? ''),
                    at
                );
                break;
            case 'custom_tool_call':
                turns.assistant(
                    toolCallText(stringField(payload, 'name') ?? 'tool', payload.input ?? ''),
                    at
                );
                break;
            case 'local_shell_call': {
                const action = isRecord(payload.action) ? payload.action : {};
                const command = Array.isArray(action.command) ? action.command : [];
                turns.assistant(toolCallText('shell', { command }), at);
                break;
            }
            case 'function_call_output':
            case 'custom_tool_call_output':
                turns.assistant(toolResultText(codexOutputText(payload.output)), at);
                break;
        }
    }
    return finishChat(
        {
            cwd,
            gitBranch,
            id: id ?? path.basename(file, '.jsonl'),
            path: file,
            source: 'codex',
            title: null,
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

// ---------------------------------------------------------------------------------------------
// Redaction and bounds
// ---------------------------------------------------------------------------------------------

/** Credential shapes, most specific first; each match becomes `[redacted:<kind>]`. */
const SECRET_PATTERNS: readonly (readonly [kind: string, pattern: RegExp])[] = [
    ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu],
    ['secret_key', /\bsk-[A-Za-z0-9_-]{20,}/gu],
    ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/gu],
    ['aws_access_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu],
    ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu],
    ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}/gu],
    ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu],
    ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gu],
];

/** `password = value` and the like: the name stays, the value goes. */
const SECRET_ASSIGNMENT =
    /\b((?:[A-Za-z0-9_]*_)?(?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)([^\s"'[]{8,})/giu;

const REDACTED_MARKER = /\[redacted:([a-z_]+)\]/gu;

export function redactSecrets(text: string): { counts: Record<string, number>; text: string } {
    const counts: Record<string, number> = {};
    const count = (kind: string) => {
        counts[kind] = (counts[kind] ?? 0) + 1;
    };
    let redacted = text;
    for (const [kind, pattern] of SECRET_PATTERNS)
        redacted = redacted.replace(pattern, () => {
            count(kind);
            return `[redacted:${kind}]`;
        });
    redacted = redacted.replace(SECRET_ASSIGNMENT, (_match, name: string) => {
        count('assignment');
        return `${name}[redacted:assignment]`;
    });
    return { counts, text: redacted };
}

type PreparedImport =
    | {
          readonly input: ChatImportInput;
          readonly kind: 'ready';
          /** How many of each kind of secret were redacted, counted from the markers sent. */
          readonly redactions: Readonly<Record<string, number>>;
          /** How many messages were cut to the size limit. */
          readonly truncated: number;
      }
    | { readonly kind: 'skipped'; readonly reason: string };

/** The chat as it is sent: redacted, each message within the size limit, or why it can't go. */
export function toImportInput(chat: LocalChat): PreparedImport {
    if (!SOURCE_SESSION_ID.test(chat.id))
        return { kind: 'skipped', reason: "Its session id isn't one Dexto takes." };
    if (chat.messages.length > MAX_IMPORT_MESSAGES)
        return { kind: 'skipped', reason: `It has more than ${MAX_IMPORT_MESSAGES} messages.` };
    let truncated = 0;
    let total = 0;
    const messages = chat.messages.map((message) => {
        const { text } = redactSecrets(message.text);
        if (text.length > MAX_MESSAGE_CHARS) truncated += 1;
        const bounded = truncate(text, MAX_MESSAGE_CHARS);
        total += bounded.length;
        return { createdAt: message.createdAt, role: message.role, text: bounded };
    });
    if (total > MAX_IMPORT_CHARS)
        return {
            kind: 'skipped',
            reason: `It has more than ${MAX_IMPORT_CHARS.toLocaleString('en-US')} characters.`,
        };
    const title = redactSecrets(chat.title).text.slice(0, MAX_TITLE_CHARS);
    const cwd = chat.cwd === null ? null : redactSecrets(chat.cwd).text;
    const gitBranch = chat.gitBranch === null ? null : redactSecrets(chat.gitBranch).text;
    const input: ChatImportInput = {
        ...(cwd === null || cwd.length > MAX_CWD_CHARS ? {} : { cwd }),
        ...(gitBranch === null || gitBranch.length > MAX_BRANCH_CHARS ? {} : { gitBranch }),
        messages,
        source: chat.source,
        sourceSessionId: chat.id,
        title: title.trim() === '' ? 'Imported chat' : title,
    };
    return { input, kind: 'ready', redactions: redactionCounts(input), truncated };
}

/** Each `[redacted:<kind>]` in what is sent, including those made while reading tool output. */
function redactionCounts(input: ChatImportInput): Record<string, number> {
    const counts: Record<string, number> = {};
    const sent = [input.title, input.cwd ?? '', input.gitBranch ?? ''];
    for (const text of [...sent, ...input.messages.map((message) => message.text)])
        for (const [, kind = ''] of text.matchAll(REDACTED_MARKER))
            counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
}

// ---------------------------------------------------------------------------------------------
// Finding them
// ---------------------------------------------------------------------------------------------

export interface LocalChatQuery {
    /** Another sessions folder to read instead of the source's own. */
    readonly dir: string | null;
    /** Keep sessions whose working directory is this folder or inside it. */
    readonly folder: string | null;
    /** Keep sessions with a turn at or after this date. */
    readonly since: string | null;
    readonly source: LocalChatSource;
}

/** Where a source keeps its sessions on this machine. */
function localChatsFolder(
    runtime: Pick<CloudRuntime, 'environment' | 'homeDirectory'>,
    source: LocalChatSource
): string {
    if (source === 'claude-code')
        return path.join(
            runtime.environment.CLAUDE_CONFIG_DIR ?? path.join(runtime.homeDirectory, '.claude'),
            'projects'
        );
    return path.join(
        runtime.environment.CODEX_HOME ?? path.join(runtime.homeDirectory, '.codex'),
        'sessions'
    );
}

/** The source's sessions on this machine that match the query, newest first. */
export async function findLocalChats(
    runtime: Pick<CloudRuntime, 'environment' | 'homeDirectory'>,
    query: LocalChatQuery
): Promise<LocalChat[]> {
    if (query.dir !== null)
        await readdir(query.dir).catch(() => {
            throw new UsageError(`--dir ${query.dir} is not a folder this can read.`);
        });
    const folder = query.dir ?? localChatsFolder(runtime, query.source);
    const since = query.since === null ? null : new Date(query.since);
    const files =
        query.source === 'claude-code' ? await claudeCodeFiles(folder) : await codexFiles(folder);
    const parse = query.source === 'claude-code' ? parseClaudeCodeTranscript : parseCodexRollout;
    const within = query.folder === null ? null : path.resolve(query.folder);
    const chats: LocalChat[] = [];
    for (const file of files) {
        const stats = await stat(file).catch(() => null);
        if (stats === null || stats.size > MAX_FILE_BYTES) continue;
        const chat = parse(await readFile(file, 'utf8'), file);
        if (chat === null) continue;
        if (since !== null && new Date(chat.updatedAt) < since) continue;
        if (within !== null && !insideFolder(chat.cwd, within)) continue;
        chats.push(chat);
    }
    return chats.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
