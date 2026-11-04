// Turns a local chat's history into the messages `POST /v1/synced_chats` takes: only what the
// person and the agent said, each tool call with its output, redacted and then cut to the
// server's limits, so a cut never leaves part of a secret that no pattern matches any more.

import type { V1Body } from '@dexto/cloud-client';
import type { ContentPart, InternalMessage, ToolCall } from '@dexto/core';
import {
    excludeSecretFile,
    isSecretPath,
    redactSecrets,
    secretPathIn,
    secretPathTail,
} from './redaction.js';

type SyncedMessageWithIndex = V1Body<'/v1/synced_chats', 'post'>['messages'][number];
export type SyncedMessage = Omit<SyncedMessageWithIndex, 'index'>;
type SyncedPart = SyncedMessage['parts'][number];
type ToolPart = Extract<SyncedPart, { type: 'tool' }>;

/** The server's limits (`apps/cloud/src/chat-sync/render.ts`). */
export const MAX_MESSAGE_CHARS = 64_000;
export const MAX_TOOL_CHARS = 4_000;
const MAX_PARTS = 50;
const MAX_TOOL_NAME_CHARS = 200;
const MAX_ATTACHMENT_NAME_CHARS = 255;

const CUT_NOTE = '\n[cut]';
/** What a message keeps back for the note that says how many parts did not fit. */
const RESERVED_FOR_NOTE = 100;

/** Argument names that hold the file a tool reads or writes. */
const PATH_ARGUMENTS = [
    'file_path',
    'filePath',
    'path',
    'file',
    'filename',
    'notebook_path',
    'target_file',
    'uri',
] as const;

/** Tools whose output lists files by name, so one naming a secret file is left out. */
const SEARCH_TOOL = /(?:^|[-_])(?:grep|glob|search|find|list_files|ls)(?:$|[-_])/u;
const SEARCH_COMMAND = /(?:^|[\s;&|(])(?:grep|rg|ag|ack|find|fd|ls|tree|git\s+grep)\s/u;
/** A tool that searches other chats: what it finds may be from a private or opted-out chat. */
const CHAT_SEARCH_TOOL = /(?:^|[-_])search_history$/u;
const CHAT_SEARCH_OUTPUT = '[not synced: what a search of other chats found]';
/** The output of a later call that reads what a call on a secret file started, such as a background command. */
const FOLLOWS_SECRET_OUTPUT = '[excluded: secret file]';
/** A file a diff shows: `diff --git a/x b/x`, `--- a/x`, `+++ b/x`. */
const DIFF_FILE =
    /^(?:diff --git a\/(\S+) b\/(\S+)|\+\+\+ b\/(\S+)|--- a\/(\S+)|Binary files a\/(\S+))/gmu;
/** A file an @ mention put in a message (core's `formatResourceContent`). */
const RESOURCE_BLOCK =
    /\n?--- Content from resource: (.*?) \((.*?)\) ---\n[\s\S]*?(?:--- End of resource content ---|$(?![\s\S]))/gu;
/** Fields of a call's output naming what it started, such as a background process. */
const STARTED_ID = /^(?:process_?id|pid|job_?id|task_?id|shell_?id|id)$/iu;

/** The chat's messages to sync, in order; their indexes are their positions. */
export function toSyncedMessages(history: readonly InternalMessage[]): SyncedMessage[] {
    const outputs = new Map<string, string>();
    for (const message of history)
        if (message.role === 'tool') outputs.set(message.toolCallId, contentText(message.content));

    // What calls on a secret file started (a background process's id): later calls naming one
    // read the same secret.
    const startedBySecretCalls = new Set<string>();
    const messages: SyncedMessage[] = [];
    let lastAt = 0;
    for (const message of history) {
        lastAt = message.timestamp ?? lastAt;
        const parts = syncedParts(message, outputs, startedBySecretCalls);
        if (parts.length === 0) continue;
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        messages.push({
            created_at: new Date(lastAt).toISOString(),
            role: message.role,
            parts,
        });
    }
    return messages;
}

function syncedParts(
    message: InternalMessage,
    outputs: ReadonlyMap<string, string>,
    startedBySecretCalls: Set<string>
): SyncedPart[] {
    if (message.metadata?.isSummary === true || message.metadata?.isSessionSummary === true)
        return [];
    switch (message.role) {
        case 'system':
        case 'tool':
            return [];
        case 'user':
            return fitToLimits(message.content.flatMap(contentPart));
        case 'assistant': {
            if (message.assistantOutput.status === 'draft') return [];
            const said = (message.content ?? []).flatMap(contentPart);
            const calls = (message.toolCalls ?? []).map((call) =>
                toolPart(call, outputs.get(call.id) ?? null, startedBySecretCalls)
            );
            return fitToLimits([...said, ...calls]);
        }
    }
}

function contentPart(part: ContentPart): SyncedPart[] {
    switch (part.type) {
        case 'text': {
            const text = redactSecrets(withoutSecretResources(part.text));
            return text.trim() === '' ? [] : [{ type: 'text', text }];
        }
        case 'image':
            return [attachment('image', part.mimeType, byteSize(part.image))];
        case 'file':
            return [attachment(part.filename ?? 'file', part.mimeType, byteSize(part.data))];
        case 'resource':
        case 'ui-resource':
            return [];
    }
}

function attachment(name: string, mimeType: string | undefined, size: number): SyncedPart {
    const safeName =
        redactSecrets(name)
            .replaceAll(/\p{Cc}/gu, ' ')
            .trim() || 'file';
    const safeType =
        mimeType !== undefined && /^[\w.+-]+\/[\w.+-]+$/u.test(mimeType) && mimeType.length <= 100
            ? mimeType
            : 'application/octet-stream';
    return {
        type: 'attachment',
        name: safeName.slice(0, MAX_ATTACHMENT_NAME_CHARS),
        mime_type: safeType,
        size_bytes: size,
    };
}

function byteSize(data: string | Uint8Array | Buffer | ArrayBuffer | URL): number {
    if (data instanceof URL) return 0;
    if (typeof data === 'string') {
        // A data URL or base64: the bytes it decodes to.
        const base64 = data.slice(data.indexOf(',') + 1).replaceAll(/[\s=]/gu, '');
        return Math.floor((base64.length * 3) / 4);
    }
    return data.byteLength;
}

function toolPart(
    call: ToolCall,
    rawOutput: string | null,
    startedBySecretCalls: Set<string>
): ToolPart {
    const name =
        call.function.name.replaceAll(/\p{Cc}/gu, ' ').slice(0, MAX_TOOL_NAME_CHARS) || 'tool';
    const input = call.function.arguments;
    const path = filePath(input);
    const secretFile = path === null ? null : excludeSecretFile(path);
    if (secretFile !== null) {
        for (const id of startedIds(rawOutput)) startedBySecretCalls.add(id);
        return {
            type: 'tool',
            name,
            input: secretFile,
            output: secretFile,
            path: redactSecrets(secretPathTail(path ?? '')),
        };
    }
    const followsSecret = [...startedBySecretCalls].some((id) => input.includes(id));
    return {
        type: 'tool',
        name,
        input: redactThenCut(input, MAX_TOOL_CHARS),
        output:
            rawOutput === null
                ? null
                : followsSecret
                  ? FOLLOWS_SECRET_OUTPUT
                  : toolOutput(name, input, rawOutput),
        path,
    };
}

function toolOutput(name: string, input: string, output: string): string {
    if (CHAT_SEARCH_TOOL.test(name)) return CHAT_SEARCH_OUTPUT;
    // A search can list a secret file, and a grep its lines, without naming it in its input.
    const listsFiles = SEARCH_TOOL.test(name) || SEARCH_COMMAND.test(input);
    const named =
        secretPathIn(input) ??
        (listsFiles ? secretPathIn(output) : null) ??
        diffedSecretFile(output);
    const excluded = named === null ? null : excludeSecretFile(named);
    return excluded ?? redactThenCut(output, MAX_TOOL_CHARS);
}

/** The first secret-shaped file a diff in the text shows, as `git log -p` or `git show` print. */
function diffedSecretFile(text: string): string | null {
    for (const match of text.matchAll(DIFF_FILE))
        for (const file of match.slice(1))
            if (file !== undefined && isSecretPath(file)) return file;
    return null;
}

/** The text with each file an @ mention put in it replaced by its marker, if the file is secret-shaped. */
function withoutSecretResources(text: string): string {
    return text.replaceAll(RESOURCE_BLOCK, (block, name: string, uri: string) => {
        const marker = excludeSecretFile(name) ?? excludeSecretFile(uri);
        return marker === null ? block : `\n${marker}`;
    });
}

/** Ids a call's output names for what it started, such as `{"process_id":"proc-7"}`. */
function startedIds(output: string | null): string[] {
    if (output === null) return [];
    const parsed = parseObject(output);
    if (parsed === null) return [];
    return Object.entries(parsed)
        .filter(
            ([key, value]) =>
                STARTED_ID.test(key) && (typeof value === 'string' || typeof value === 'number')
        )
        .map(([, value]) => String(value))
        .filter((id) => id.length >= 3);
}

/**
 * The file a call reads or writes: a secret-shaped path anywhere in its input first, so the
 * server leaves out that call's input and output, then the argument that names its file.
 */
function filePath(input: string): string | null {
    const secret = secretPathIn(input);
    if (secret !== null) return secret.replaceAll(/\p{Cc}/gu, '').slice(0, 1_024);
    const args = parseObject(input);
    if (args === null) return null;
    for (const key of PATH_ARGUMENTS) {
        const value = args[key];
        if (typeof value !== 'string' || value.trim() === '') continue;
        const path = value.startsWith('file://') ? decodeFileUrl(value) : value;
        if (key === 'uri' && path === value) continue;
        const clean = path.replaceAll(/\p{Cc}/gu, '').slice(0, 1_024);
        if (clean !== '') return isSecretPath(clean) ? clean : redactSecrets(clean);
    }
    return null;
}

function decodeFileUrl(url: string): string {
    try {
        return decodeURIComponent(new URL(url).pathname);
    } catch {
        return url;
    }
}

function parseObject(text: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value))
            : null;
    } catch {
        return null;
    }
}

function contentText(content: readonly ContentPart[]): string {
    return content
        .map((part) => {
            switch (part.type) {
                case 'text':
                    return part.text;
                case 'image':
                    return '[image]';
                case 'file':
                    return `[file${part.filename === undefined ? '' : ` ${part.filename}`}]`;
                case 'resource':
                    return `[resource ${part.name}]`;
                case 'ui-resource':
                    return '[ui resource]';
            }
        })
        .join('\n');
}

/** Text already redacted, cut to `max` characters with a note that it was. */
function cut(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${sliceWhole(text, max - CUT_NOTE.length)}${CUT_NOTE}`;
}

/** The first `length` characters, one fewer if the last would split an emoji's surrogate pair. */
export function sliceWhole(text: string, length: number): string {
    const end = /[\uD800-\uDBFF]/u.test(text.charAt(length - 1)) ? length - 1 : length;
    return text.slice(0, end);
}

/** How much of a long tool text is redacted before it is cut. */
const REDACTION_WINDOW = 16_000;
/** Longer than any credential a pattern matches, private keys included. */
const LONGEST_SECRET = 4_000;

/**
 * A tool's text redacted, then cut to `max`. Only its start is redacted when that is enough:
 * whatever the window's end splits lies past the cut.
 */
function redactThenCut(text: string, max: number): string {
    if (text.length <= REDACTION_WINDOW) return cut(redactSecrets(text), max);
    const start = redactSecrets(text.slice(0, REDACTION_WINDOW));
    if (start.length - LONGEST_SECRET >= max) return cut(start, max);
    return cut(redactSecrets(text), max);
}

/** How long the server renders the part (`apps/cloud/src/chat-sync/render.ts`): headers and fences count. */
function partChars(part: SyncedPart): number {
    switch (part.type) {
        case 'text':
            return part.text.length;
        case 'tool': {
            const call = `**Tool call: ${part.name}**\n`.length + fencedLength(part.input);
            return part.output === null
                ? call
                : call + '\n**Output**\n'.length + fencedLength(part.output);
        }
        case 'attachment':
            return `[attachment: ${part.name} (${part.mime_type}, ${part.size_bytes} bytes)]`
                .length;
    }
}

/** A code block's length: its fence is longer than any backtick run inside it. */
function fencedLength(text: string): number {
    const longestRun = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
    return text.length + 2 * (Math.max(3, longestRun + 1) + 1);
}

/** Parts render joined by a blank line. */
const PART_SEPARATOR_CHARS = 2;

function messageChars(parts: readonly SyncedPart[]): number {
    const separators = Math.max(0, parts.length - 1) * PART_SEPARATOR_CHARS;
    return parts.reduce((sum, part) => sum + partChars(part), separators);
}

/**
 * The parts that fit the server's limits for one message, in order: each part shrinks to the
 * characters left, and a last note says how many did not fit.
 */
function fitToLimits(parts: readonly SyncedPart[]): SyncedPart[] {
    if (parts.length <= MAX_PARTS && messageChars(parts) <= MAX_MESSAGE_CHARS) return [...parts];

    const kept: SyncedPart[] = [];
    let left = MAX_MESSAGE_CHARS - RESERVED_FOR_NOTE;
    for (const part of parts) {
        if (kept.length === MAX_PARTS - 1) break;
        const fitted = shrink(part, left);
        if (fitted === null) break;
        kept.push(fitted);
        left -= partChars(fitted) + PART_SEPARATOR_CHARS;
    }
    const dropped = parts.length - kept.length;
    if (dropped > 0)
        kept.push({
            type: 'text',
            text: `[${dropped} more part${dropped === 1 ? '' : 's'} of this message not synced]`,
        });
    return kept;
}

/** The part cut to at most `left` characters, or null when too little room is left for it. */
function shrink(part: SyncedPart, left: number): SyncedPart | null {
    if (partChars(part) <= left) return part;
    if (left < 200) return null;
    switch (part.type) {
        case 'text':
            return { ...part, text: cut(part.text, left) };
        case 'tool': {
            // What the headers and fences take; cutting the text only shortens the fences.
            const overhead = partChars(part) - part.input.length - (part.output?.length ?? 0);
            const room = left - overhead;
            if (room < 200) return null;
            const input = cut(part.input, Math.floor(room / 2));
            const output = part.output === null ? null : cut(part.output, room - input.length);
            return { ...part, input, output };
        }
        case 'attachment':
            return part;
    }
}
