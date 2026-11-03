// Turns a local chat into what `dexto_chat_import` takes: redacted here, and within its bounds.

import type { LocalChat, LocalChatMessage, LocalChatSource } from './transcript.js';

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
export const MAX_IMPORT_CHARS = 4_000_000;
const MAX_TITLE_CHARS = 200;
const MAX_CWD_CHARS = 1_024;
const MAX_BRANCH_CHARS = 255;
const SOURCE_SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/u;

export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const marker = `\n… [${text.length - max} more characters left out]`;
    return `${text.slice(0, Math.max(0, max - marker.length))}${marker}`;
}

/** Credential shapes, most specific first; each match becomes `[redacted:<kind>]`. */
const SECRET_PATTERNS: readonly (readonly [kind: string, pattern: RegExp])[] = [
    ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu],
    ['secret_key', /\bsk-[A-Za-z0-9_-]{20,}/gu],
    ['secret_key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{8,}/gu],
    ['gitlab_token', /\bglpat-[A-Za-z0-9_-]{8,}/gu],
    ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/gu],
    ['aws_access_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu],
    ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu],
    ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}/gu],
    ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu],
    ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gu],
    ['auth_token', /\bAuthorization\s*:\s*(?:Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/giu],
];

/** `password = value` and the like: the name stays, the value goes. */
const SECRET_ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_-]*)(\\*["']?\s*[:=]\s*\\*["']?)([^\s"'[]{8,})/gu;

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
    redacted = redacted.replace(
        /(:\/\/[^\s/:@]+:)([^\s/]+)(@)/gu,
        (_match, prefix: string, _password: string, suffix: string) => {
            count('url_password');
            return `${prefix}[redacted:url_password]${suffix}`;
        }
    );
    redacted = redacted.replace(
        SECRET_ASSIGNMENT,
        (match, name: string, separator: string, value: string) => {
            const words = name
                .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
                .toLowerCase()
                .split(/[_-]+/u);
            const secret =
                words.some((word) =>
                    ['password', 'passwd', 'pass', 'secret', 'token'].includes(word)
                ) ||
                words.some(
                    (word, index) =>
                        ['api', 'private', 'access'].includes(word) && words[index + 1] === 'key'
                );
            if (!secret || /^z\.\w+\(/u.test(value)) return match;
            count('assignment');
            return `${name}${separator}[redacted:assignment]`;
        }
    );
    return { counts, text: redacted };
}

export type PreparedImport =
    | {
          readonly input: ChatImportInput;
          readonly kind: 'ready';
          /** How many of the session's oldest messages were left out to fit the import's bounds. */
          readonly leftOut: number;
          /** How many of each kind of secret were redacted, counted from the markers sent. */
          readonly redactions: Readonly<Record<string, number>>;
          /** How many messages were cut to the size limit. */
          readonly truncated: number;
      }
    | { readonly kind: 'skipped'; readonly reason: string };

const SOURCE_NAMES: Readonly<Record<LocalChatSource, string>> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
};

/** The first message of a chat whose oldest messages were left out, saying so. */
function leftOutNote(source: LocalChatSource, leftOut: number): string {
    const what =
        leftOut === 1
            ? 'the first message of this session was'
            : `the first ${leftOut.toLocaleString('en-US')} messages of this session were`;
    return `[Imported from ${SOURCE_NAMES[source]}: ${what} left out. Dexto imports up to a session's newest ${MAX_IMPORT_MESSAGES.toLocaleString('en-US')} messages.]`;
}

/**
 * The chat as it is sent: redacted, and each message within the size limit. A session longer than
 * the import's bounds keeps its newest messages, after a note that says how many were left out.
 */
export function toImportInput(
    chat: Pick<LocalChat, 'cwd' | 'gitBranch' | 'id' | 'messages' | 'source' | 'title'>
): PreparedImport {
    if (!SOURCE_SESSION_ID.test(chat.id))
        return { kind: 'skipped', reason: "Its session id isn't one Dexto takes." };
    let truncated = 0;
    const bounded = chat.messages.map((message) => {
        const { text } = redactSecrets(message.text);
        if (text.length > MAX_MESSAGE_CHARS) truncated += 1;
        return {
            createdAt: message.createdAt,
            role: message.role,
            text: truncate(text, MAX_MESSAGE_CHARS),
        };
    });
    const { leftOut, messages } = newestWithin(bounded, chat.source);
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
    return { input, kind: 'ready', leftOut, redactions: redactionCounts(input), truncated };
}

/**
 * The messages as they are when they fit the import's message and character bounds; otherwise a
 * note saying how many were left out, then the newest messages that fit alongside it.
 */
function newestWithin(
    messages: readonly LocalChatMessage[],
    source: LocalChatSource
): { leftOut: number; messages: LocalChatMessage[] } {
    const chars = messages.reduce((sum, message) => sum + message.text.length, 0);
    if (messages.length <= MAX_IMPORT_MESSAGES && chars <= MAX_IMPORT_CHARS)
        return { leftOut: 0, messages: [...messages] };
    // The note's own length depends on the count it states; the widest count fits every count.
    const noteChars = leftOutNote(source, messages.length).length;
    const kept: LocalChatMessage[] = [];
    let total = noteChars;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message === undefined) break;
        if (kept.length === MAX_IMPORT_MESSAGES - 1) break;
        if (total + message.text.length > MAX_IMPORT_CHARS) break;
        kept.push(message);
        total += message.text.length;
    }
    kept.reverse();
    const leftOut = messages.length - kept.length;
    // Date the note before all retained messages, including when source timestamps tie or regress.
    const lastLeftOut = messages[leftOut - 1];
    if (lastLeftOut === undefined) return { leftOut: 0, messages: kept };
    const note: LocalChatMessage = {
        createdAt: new Date(
            Math.min(
                Date.parse(lastLeftOut.createdAt),
                ...kept.map((message) => Date.parse(message.createdAt) - 1)
            )
        ).toISOString(),
        role: 'assistant',
        text: leftOutNote(source, leftOut),
    };
    return { leftOut, messages: [note, ...kept] };
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
