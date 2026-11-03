// What a local Claude Code or Codex session reads into, and the helpers both parsers share.

import { redactSecrets, truncate } from './redaction.js';

export type LocalChatSource = 'claude-code' | 'codex';
export const LOCAL_CHAT_SOURCES: readonly LocalChatSource[] = ['claude-code', 'codex'];

export interface LocalChatMessage {
    readonly createdAt: string;
    readonly role: 'assistant' | 'user';
    readonly text: string;
}

/** A pull request the session opened or worked on, as Claude Code's `pr-link` lines record it. */
export interface LocalPullRequest {
    readonly number: number;
    /** `owner/name` on GitHub. */
    readonly repository: string;
    readonly url: string;
}

/** The git repository a session ran in. */
export interface LocalRepository {
    /**
     * The main checkout's folder, so a worktree's sessions name the repository it belongs to; null
     * when the folder the session ran in is no longer on this machine.
     */
    readonly root: string | null;
    /** The `origin` remote, without any credentials in it, or null when there is none. */
    readonly remoteUrl: string | null;
}

export interface LocalChat {
    /** Where the session started. */
    readonly cwd: string | null;
    readonly gitBranch: string | null;
    readonly id: string;
    readonly messages: readonly LocalChatMessage[];
    /** The transcript file it was read from. */
    readonly path: string;
    readonly pullRequests: readonly LocalPullRequest[];
    /** The repository `cwd` is in, or null when it is in none or nothing about it is known. */
    readonly repository: LocalRepository | null;
    readonly source: LocalChatSource;
    readonly startedAt: string;
    readonly title: string;
    readonly updatedAt: string;
}

/** What a parser reads from the transcript alone; the finder adds the repository from disk. */
export type ParsedChat = Omit<LocalChat, 'repository'> & {
    /** The `origin` the source recorded when the session ran, if it records one. */
    readonly recordedRemoteUrl: string | null;
};

/**
 * Collects turns as a chat shows them: each person's message, then one assistant message holding
 * everything the agent said and ran until the next one.
 */
export function createTurns() {
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
        done(): Turns {
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

interface Turns {
    readonly lastAt: string | null;
    readonly messages: readonly LocalChatMessage[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(value: Record<string, unknown>, key: string): string | null {
    const field = value[key];
    return typeof field === 'string' && field.trim() !== '' ? field : null;
}

/** Each line that is a JSON object; a torn or foreign line is left out. */
export function jsonLines(text: string): Record<string, unknown>[] {
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

export function validTime(value: string | null): string | null {
    if (value === null) return null;
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function firstLine(text: string): string {
    const line = text.split('\n').find((each) => each.trim() !== '') ?? '';
    return truncate(redactSecrets(line.trim()).text, 80);
}

/**
 * The chat, titled by what the source named it or else by the person's first line; null when
 * there is nothing the person said.
 */
export function finishChat(
    fields: Omit<ParsedChat, 'messages' | 'startedAt' | 'title' | 'updatedAt'> & {
        readonly title: string | null;
    },
    { lastAt, messages }: Turns
): ParsedChat | null {
    const first = messages[0];
    const firstUser = messages.find((message) => message.role === 'user');
    if (first === undefined || lastAt === null || firstUser === undefined) return null;
    return {
        ...fields,
        messages,
        startedAt: first.createdAt,
        title: truncate(redactSecrets(fields.title?.trim() ?? firstLine(firstUser.text)).text, 200),
        updatedAt: lastAt,
    };
}

// ---------------------------------------------------------------------------------------------
// Tool history as text
// ---------------------------------------------------------------------------------------------

/** How much of one tool call's input or result an imported chat keeps. */
const MAX_TOOL_CHARS = 4_000;

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

/** A JSON string pretty-printed, or as it is when it isn't JSON. */
function prettyJson(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

export function toolCallText(name: string, input: unknown): string {
    const body =
        typeof input === 'string'
            ? prettyJson(redactSecrets(input).text)
            : JSON.stringify(
                  input ?? null,
                  (_key, value: unknown) =>
                      typeof value === 'string' ? redactSecrets(value).text : value,
                  2
              );
    return `**Tool call: ${name}**\n${toolBody(body)}`;
}

export function toolResultText(output: string): string {
    return `**Tool result**\n${toolBody(output)}`;
}
