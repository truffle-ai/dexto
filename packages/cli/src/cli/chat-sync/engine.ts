// Syncs local chats to the signed-in person's Dexto Cloud through `POST /v1/synced_chats`, and
// deletes a chat's cloud copy when the local chat is deleted or made private. Only what the
// person and the agent said goes, redacted (messages.ts). The server re-redacts everything.
//
// Back-off: 429 and 413 wait as long as Retry-After says (a 413 without one sends a smaller
// batch, and stops a chat whose one message is still too large); 409 sync_diverged stops a chat
// for good; 409 chat_in_cloud and move_in_progress pause it; 409 synced_chat_limit holds back new
// chats while synced ones keep syncing.

import { CloudApiError, unwrap, type CloudClient, type V1Body } from '@dexto/cloud-client';
import type { InternalMessage } from '@dexto/core';
import { toSyncedMessages, type SyncedMessage } from './messages.js';
import { redactSecrets } from './redaction.js';
import { syncAllowed, type ChatSyncState, type ChatSyncStore } from './store.js';

/** The server's limits (`apps/cloud/src/hono/routes/v1/synced-chats.ts`). */
const MAX_BATCH_MESSAGES = 200;
const MAX_BATCH_CHARS = 4_000_000;
export const SYNCED_CHAT_LIMIT = 1_000;
const MAX_TITLE_CHARS = 200;

const DEFAULT_RETRY_AFTER_MS = 60_000;
const PAUSE_RECHECK_MS = 5 * 60_000;
const CHAT_LIMIT_RECHECK_MS = 60 * 60_000;
const FIRST_FAILURE_WAIT_MS = 30_000;
const LONGEST_FAILURE_WAIT_MS = 30 * 60_000;

/** A local chat as it is now. */
export interface LocalChat {
    readonly id: string;
    readonly title: string | null;
    readonly cwd: string | null;
    readonly gitBranch: string | null;
    readonly messages: readonly InternalMessage[];
}

/** The signed-in person's client, and the account the sync state is kept for. */
export interface SyncConnection {
    readonly client: CloudClient;
    /** The account and organization, as a file name: `<organization id>-<account id>`. */
    readonly account: string;
}

export interface ChatSyncDeps {
    readonly store: ChatSyncStore;
    /** The person's connection, or null when nobody is signed in with a person's login. */
    readonly connect: () => Promise<SyncConnection | null>;
    readonly readChat: (chatId: string) => Promise<LocalChat | null>;
    /** Tells the person something they need to know, once. */
    readonly note: (text: string) => void;
    readonly now: () => number;
    /** Syncs the chat again in `ms`, for a wait the server asked for. */
    readonly schedule: (ms: number, chatId: string) => void;
    readonly machineName: string;
    readonly cliVersion: string;
}

export interface ChatSync {
    /** Sends what the chat holds that its cloud copy doesn't, when it may sync. */
    readonly sync: (chatId: string) => Promise<void>;
    /** The local chat was deleted: delete its cloud copy, on every account it synced to. */
    readonly deleteLocalChat: (chatId: string) => Promise<void>;
    /** Never sync the chat again, and delete its cloud copy. */
    readonly makePrivate: (chatId: string) => Promise<void>;
    /** Lets a private chat sync again, as a new cloud chat. */
    readonly makeShared: (chatId: string) => Promise<void>;
    /** Sends the deletes that failed before, for the signed-in account. */
    readonly sendPendingDeletes: () => Promise<void>;
}

type Body = V1Body<'/v1/synced_chats', 'post'>;
/** A chat that may still sync. */
type ActiveState = Exclude<ChatSyncState, { status: 'stopped' }>;

export function createChatSync(deps: ChatSyncDeps): ChatSync {
    /** One sync or delete at a time per chat. */
    const running = new Map<string, Promise<void>>();
    /** No request before this time: a 429 or 413 asked to wait. */
    let waitUntil = 0;
    /** The token lacks chats:sync or stopped working: nothing syncs until the CLI starts again. */
    let refused = false;
    /** Per chat, after a failure: the next try, and how many failed in a row. */
    const failures = new Map<string, { retryAt: number; count: number }>();
    const noted = new Set<string>();

    const noteOnce = (key: string, text: string) => {
        if (noted.has(key)) return;
        noted.add(key);
        deps.note(text);
    };

    const serialized = (chatId: string, work: () => Promise<void>): Promise<void> => {
        const previous = running.get(chatId) ?? Promise.resolve();
        const next = previous.then(work, work);
        running.set(chatId, next);
        return next.finally(() => {
            if (running.get(chatId) === next) running.delete(chatId);
        });
    };

    async function syncNow(chatId: string): Promise<void> {
        if (refused || deps.now() < waitUntil) return;
        const failure = failures.get(chatId);
        if (failure !== undefined && deps.now() < failure.retryAt) return;

        const settings = await deps.store.readSettings();
        if (settings.noticeShownAt === null) return;
        const chat = await deps.readChat(chatId);
        if (chat === null || !syncAllowed(settings, chat)) return;
        const connection = await deps.connect();
        if (connection === null) return;

        const saved = await deps.store.readChat(connection.account, chatId);
        if (saved?.status === 'stopped') return;
        let state: ActiveState = saved ?? {
            status: 'syncing',
            cloudChatId: null,
            nextIndex: 0,
            sentCount: 0,
        };
        if (state.status === 'paused' && deps.now() < Date.parse(state.since) + PAUSE_RECHECK_MS)
            return;
        if (state.cloudChatId === null) {
            const account = await deps.store.readAccount(connection.account);
            if (account.chatLimitUntil !== null && deps.now() < Date.parse(account.chatLimitUntil))
                return;
        }

        const messages = toSyncedMessages(chat.messages);
        let batchLimit = MAX_BATCH_MESSAGES;
        while (state.sentCount < messages.length) {
            // Signing out stops a sync between batches.
            const current = await deps.connect();
            if (current === null || current.account !== connection.account) return;
            const batch = takeBatch(messages.slice(state.sentCount), batchLimit);
            const body: Body = {
                from_index: state.nextIndex,
                local_chat_id: chat.id,
                machine: { id: settings.machineId, name: field(deps.machineName, 64) || 'machine' },
                title: titleOf(chat, messages),
                cli_version: field(deps.cliVersion, 100) || 'unknown',
                ...(chat.cwd !== null &&
                    field(chat.cwd, 1_024) !== '' && { cwd: field(chat.cwd, 1_024) }),
                ...(chat.gitBranch !== null &&
                    field(chat.gitBranch, 255) !== '' && {
                        git_branch: field(chat.gitBranch, 255),
                    }),
                messages: batch.map((message, offset) => ({
                    ...message,
                    index: state.nextIndex + offset,
                })),
            };
            let synced: { id: string; next_index: number };
            try {
                synced = await unwrap(await connection.client.POST('/v1/synced_chats', { body }));
            } catch (error) {
                const outcome = await refusedSync(
                    error,
                    connection.account,
                    chat,
                    state,
                    batch.length
                );
                if (outcome.kind === 'retry_smaller') {
                    batchLimit = outcome.limit;
                    continue;
                }
                if (outcome.kind === 'rewind') {
                    state = outcome.state;
                    continue;
                }
                if (outcome.state !== null)
                    await deps.store.writeChat(connection.account, chat.id, outcome.state);
                return;
            }
            failures.delete(chat.id);
            state = {
                status: 'syncing',
                cloudChatId: synced.id,
                nextIndex: synced.next_index,
                sentCount: state.sentCount + batch.length,
            };
            await deps.store.writeChat(connection.account, chat.id, state);
        }
        // A paused chat that has nothing new to send stays paused until it next does.
    }

    type Outcome =
        | { kind: 'retry_smaller'; limit: number }
        | { kind: 'rewind'; state: ActiveState }
        | { kind: 'done'; state: ChatSyncState | null };

    async function refusedSync(
        error: unknown,
        account: string,
        chat: LocalChat,
        state: ActiveState,
        batchSize: number
    ): Promise<Outcome> {
        if (!(error instanceof CloudApiError)) {
            failedFor(chat.id);
            return { kind: 'done', state: null };
        }
        switch (error.status) {
            case 429:
                waitFor(error.retryAfterSeconds, chat.id);
                return { kind: 'done', state: null };
            case 413:
                if (error.retryAfterSeconds !== null) {
                    waitFor(error.retryAfterSeconds, chat.id);
                    return { kind: 'done', state: null };
                }
                if (batchSize > 1)
                    return { kind: 'retry_smaller', limit: Math.ceil(batchSize / 2) };
                noteOnce(
                    `full:${chat.id}`,
                    `${named(chat)} stopped syncing: its copy in Dexto Cloud holds as much as a synced chat can. It keeps everything on this machine.`
                );
                return {
                    kind: 'done',
                    state: {
                        status: 'stopped',
                        reason: 'chat_full',
                        cloudChatId: state.cloudChatId,
                    },
                };
            case 401:
            case 403:
                refused = true;
                noteOnce(
                    'refused',
                    error.status === 403 && hasScope(error.details, 'chats:sync')
                        ? 'Chat sync needs your permission: run dexto login to allow it, or /sync off to stop syncing.'
                        : 'Chat sync stopped: Dexto Cloud refused your sign-in. Run dexto login to sign in again.'
                );
                return { kind: 'done', state: null };
            case 409:
                return conflict(error, account, chat, state);
            default:
                failedFor(chat.id);
                return { kind: 'done', state: null };
        }
    }

    async function conflict(
        error: CloudApiError,
        account: string,
        chat: LocalChat,
        state: ActiveState
    ): Promise<Outcome> {
        switch (error.code) {
            case 'sync_diverged':
                noteOnce(
                    `diverged:${chat.id}`,
                    `${named(chat)} stopped syncing: it no longer matches its copy in Dexto Cloud, which keeps what synced before.`
                );
                return {
                    kind: 'done',
                    state: {
                        status: 'stopped',
                        reason: 'sync_diverged',
                        cloudChatId: state.cloudChatId,
                    },
                };
            case 'chat_in_cloud':
            case 'move_in_progress':
                return {
                    kind: 'done',
                    state: {
                        status: 'paused',
                        reason: error.code,
                        since: new Date(deps.now()).toISOString(),
                        cloudChatId: state.cloudChatId,
                        nextIndex: state.nextIndex,
                        sentCount: state.sentCount,
                    },
                };
            case 'sync_gap': {
                const next = nextIndexIn(error.details);
                // The server holds fewer messages than this chat sent: send again from its end.
                const sentCount = next === null ? -1 : state.sentCount - (state.nextIndex - next);
                if (next === null || sentCount < 0 || next >= state.nextIndex) {
                    failedFor(chat.id);
                    return { kind: 'done', state: null };
                }
                return { kind: 'rewind', state: { ...state, nextIndex: next, sentCount } };
            }
            case 'synced_chat_limit': {
                const saved = await deps.store.readAccount(account);
                await deps.store.writeAccount(account, {
                    ...saved,
                    chatLimitUntil: new Date(deps.now() + CHAT_LIMIT_RECHECK_MS).toISOString(),
                });
                noteOnce(
                    'chat_limit',
                    `Dexto Cloud keeps up to ${SYNCED_CHAT_LIMIT.toLocaleString('en-US')} synced chats for you, and you have reached that. New chats stay on this machine only; chats already synced keep syncing. Deleting a synced chat makes room: delete it in Dexto Cloud, or delete the local chat with dexto chat delete.`
                );
                return { kind: 'done', state: null };
            }
            default:
                failedFor(chat.id);
                return { kind: 'done', state: null };
        }
    }

    function waitFor(seconds: number | null, chatId: string): void {
        const ms = seconds === null ? DEFAULT_RETRY_AFTER_MS : seconds * 1_000;
        waitUntil = Math.max(waitUntil, deps.now() + ms);
        deps.schedule(waitUntil - deps.now(), chatId);
    }

    function failedFor(chatId: string): void {
        const count = (failures.get(chatId)?.count ?? 0) + 1;
        const wait = Math.min(FIRST_FAILURE_WAIT_MS * 2 ** (count - 1), LONGEST_FAILURE_WAIT_MS);
        failures.set(chatId, { retryAt: deps.now() + wait, count });
    }

    /** Deletes the account's pending cloud chats; keeps those it could not delete yet. */
    async function deletePending(connection: SyncConnection): Promise<void> {
        const account = await deps.store.readAccount(connection.account);
        const left: string[] = [];
        let deleted = false;
        for (const cloudChatId of account.pendingDeletes) {
            const outcome = await deleteCloudChat(connection.client, cloudChatId);
            if (outcome === 'deleted') deleted = true;
            if (outcome === 'retry') left.push(cloudChatId);
        }
        await deps.store.writeAccount(connection.account, {
            ...(await deps.store.readAccount(connection.account)),
            pendingDeletes: left,
            // A delete makes room, so new chats may sync again at once.
            ...(deleted && { chatLimitUntil: null }),
        });
    }

    async function deleteCloudChat(
        client: CloudClient,
        cloudChatId: string
    ): Promise<'deleted' | 'gone' | 'retry'> {
        try {
            await unwrap(
                await client.DELETE('/v1/synced_chats/{chat_id}', {
                    params: { path: { chat_id: cloudChatId } },
                })
            );
            return 'deleted';
        } catch (error) {
            if (!(error instanceof CloudApiError)) return 'retry';
            if (error.status === 404) return 'gone';
            if (error.code === 'chat_in_cloud') {
                noteOnce(
                    `in_cloud:${cloudChatId}`,
                    'This chat continues in Dexto Cloud, so its copy there was not deleted. Delete it in Dexto Cloud.'
                );
                return 'gone';
            }
            // move_in_progress, a rate limit or a server failure: try again later.
            return 'retry';
        }
    }

    /** Moves the chat's cloud copy, on every account it synced to, to that account's deletes. */
    async function forgetEverywhere(chatId: string): Promise<void> {
        for (const account of await deps.store.listAccounts()) {
            const state = await deps.store.readChat(account, chatId);
            if (state === null) continue;
            if (state.cloudChatId !== null) {
                const saved = await deps.store.readAccount(account);
                if (!saved.pendingDeletes.includes(state.cloudChatId))
                    await deps.store.writeAccount(account, {
                        ...saved,
                        pendingDeletes: [...saved.pendingDeletes, state.cloudChatId],
                    });
            }
            await deps.store.forgetChat(account, chatId);
        }
        failures.delete(chatId);
        const connection = await deps.connect();
        if (connection !== null) await deletePending(connection);
    }

    return {
        sync: (chatId) => serialized(chatId, () => syncNow(chatId)),
        deleteLocalChat: (chatId) => serialized(chatId, () => forgetEverywhere(chatId)),
        makePrivate: (chatId) =>
            serialized(chatId, async () => {
                const settings = await deps.store.readSettings();
                if (!settings.privateChats.includes(chatId))
                    await deps.store.writeSettings({
                        ...settings,
                        privateChats: [...settings.privateChats, chatId],
                    });
                await forgetEverywhere(chatId);
            }),
        makeShared: (chatId) =>
            serialized(chatId, async () => {
                const settings = await deps.store.readSettings();
                await deps.store.writeSettings({
                    ...settings,
                    privateChats: settings.privateChats.filter((id) => id !== chatId),
                });
            }),
        sendPendingDeletes: async () => {
            const connection = await deps.connect();
            if (connection !== null) await deletePending(connection);
        },
    };
}

/** The next messages to send: at most `limit`, and within the request's character budget. */
function takeBatch(messages: readonly SyncedMessage[], limit: number): SyncedMessage[] {
    const batch: SyncedMessage[] = [];
    let chars = 0;
    for (const message of messages.slice(0, limit)) {
        const size = JSON.stringify(message).length;
        if (batch.length > 0 && chars + size > MAX_BATCH_CHARS) break;
        batch.push(message);
        chars += size;
    }
    return batch;
}

/** The chat's title, or its first words; the server redacts it again. */
function titleOf(chat: LocalChat, messages: readonly SyncedMessage[]): string {
    const firstText = messages
        .flatMap((message) => message.parts)
        .find((part) => part.type === 'text');
    const raw = chat.title ?? (firstText?.type === 'text' ? firstText.text : null) ?? 'Chat';
    return field(raw.replaceAll(/\s+/gu, ' '), MAX_TITLE_CHARS) || 'Chat';
}

/** A short text field: redacted, without control characters, at most `max` characters. */
function field(text: string, max: number): string {
    return redactSecrets(text)
        .replaceAll(/\p{Cc}/gu, '')
        .trim()
        .slice(0, max)
        .trim();
}

/** How a note names a chat. */
function named(chat: LocalChat): string {
    return chat.title === null ? 'A chat' : `"${field(chat.title, 60)}"`;
}

function hasScope(details: unknown, scope: string): boolean {
    return (
        typeof details === 'object' && details !== null && Reflect.get(details, 'scope') === scope
    );
}

function nextIndexIn(details: unknown): number | null {
    if (typeof details !== 'object' || details === null) return null;
    const next: unknown = Reflect.get(details, 'next_index');
    return typeof next === 'number' && Number.isInteger(next) && next >= 0 ? next : null;
}
