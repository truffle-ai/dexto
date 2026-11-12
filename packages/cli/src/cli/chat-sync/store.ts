// What chat sync keeps on this machine, under ~/.dexto/chat-sync, readable only by this user:
// the person's choices (settings.json), and per signed-in account, how far each chat has synced
// (<account>/chats/<chat>.json) and what is waiting on the server (<account>/account.json).

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const SettingsSchema = z
    // Loose: a newer CLI's fields survive this one's writes.
    .looseObject({
        /** A random id for this machine; with a chat's id it names one synced chat. */
        machineId: z.uuid(),
        /** When the first-run notice was shown; nothing syncs before it is. */
        noticeShownAt: z.string().nullable(),
        /** On or off everywhere; on counts only with `syncChosenAt` (see syncIsOn). */
        sync: z.enum(['on', 'off']),
        /**
         * When the person turned sync on with /sync on. 2.0 betas saved `sync: 'on'` by default
         * without it, so their saved 'on' reads as off. Default on waits for 2.1 (DEXTO-2043).
         */
        syncChosenAt: z.string().nullable().default(null),
        /** Folders whose chats never sync, absolute; a chat in a folder inside one doesn't either. */
        projectsOff: z.array(z.string()),
        /** Local chats made private with /private: never synced, on any account. */
        privateChats: z.array(z.string()),
    });

export type ChatSyncSettings = z.output<typeof SettingsSchema>;

/** The settings file exists but can't be read: nothing syncs until it is fixed or deleted. */
export class UnreadableSettingsError extends Error {
    constructor(file: string) {
        super(`${file} can't be read, so no chat syncs. Fix or delete it to sync again.`);
        this.name = 'UnreadableSettingsError';
    }
}

const Progress = {
    /** The chat in Dexto Cloud, once the first batch created it. */
    cloudChatId: z.uuid().nullable(),
    /** The server's index for the next message: its `next_index`. */
    nextIndex: z.number().int().nonnegative(),
    /** How many of the local chat's messages have synced. */
    sentCount: z.number().int().nonnegative(),
};

const ChatStateSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('syncing'), ...Progress }).strict(),
    /** The chat continues in the cloud, or is moving: sync again once it is back. */
    z
        .object({
            status: z.literal('paused'),
            reason: z.enum(['chat_in_cloud', 'move_in_progress']),
            since: z.string(),
            ...Progress,
        })
        .strict(),
    /** Never synced again: the cloud chat no longer matches, or holds all it can. */
    z
        .object({
            status: z.literal('stopped'),
            reason: z.enum(['sync_diverged', 'chat_full', 'deleted_in_cloud']),
            cloudChatId: z.uuid().nullable(),
        })
        .strict(),
]);

export type ChatSyncState = z.output<typeof ChatStateSchema>;

const AccountStateSchema = z
    .object({
        /** Until when no new chat is created: the account held its most synced chats. */
        chatLimitUntil: z.string().nullable(),
        /** Cloud chats to delete: their local chat was deleted or made private. */
        pendingDeletes: z.array(z.uuid()),
    })
    .strict();

export type AccountSyncState = z.output<typeof AccountStateSchema>;

const LOCAL_CHAT_ID = /^[A-Za-z0-9._:-]{1,200}$/u;
const ACCOUNT_KEY = /^[A-Za-z0-9_-]{1,128}$/u;

export interface ChatSyncStore {
    readonly readSettings: () => Promise<ChatSyncSettings>;
    readonly writeSettings: (settings: ChatSyncSettings) => Promise<void>;
    /** Changes the settings one change at a time, from the settings as they are now. */
    readonly updateSettings: (
        change: (settings: ChatSyncSettings) => ChatSyncSettings
    ) => Promise<ChatSyncSettings>;
    readonly readChat: (account: string, chatId: string) => Promise<ChatSyncState | null>;
    readonly writeChat: (account: string, chatId: string, state: ChatSyncState) => Promise<void>;
    readonly forgetChat: (account: string, chatId: string) => Promise<void>;
    readonly readAccount: (account: string) => Promise<AccountSyncState>;
    readonly writeAccount: (account: string, state: AccountSyncState) => Promise<void>;
    /** Every account that has sync state on this machine. */
    readonly listAccounts: () => Promise<string[]>;
    /** The folder a chat works in, kept from when sync first saw it; null when not kept yet. */
    readonly readChatFolder: (chatId: string) => Promise<string | null>;
    readonly writeChatFolder: (chatId: string, folder: string) => Promise<void>;
}

const ChatFolderSchema = z.object({ folder: z.string().min(1) }).strict();

/** The store under `dir`, normally `~/.dexto/chat-sync`. */
export function chatSyncStore(dir: string): ChatSyncStore {
    const settingsFile = path.join(dir, 'settings.json');
    const accountDir = (account: string) => {
        if (!ACCOUNT_KEY.test(account)) throw new Error(`${account} can't name a sync account.`);
        return path.join(dir, account);
    };
    const chatFile = (account: string, chatId: string) => {
        if (!LOCAL_CHAT_ID.test(chatId)) throw new Error(`${chatId} can't name a synced chat.`);
        return path.join(accountDir(account), 'chats', `${chatId}.json`);
    };
    const folderFile = (chatId: string) => {
        if (!LOCAL_CHAT_ID.test(chatId)) throw new Error(`${chatId} can't name a synced chat.`);
        return path.join(dir, 'folders', `${chatId}.json`);
    };
    let settingsWrites: Promise<void> = Promise.resolve();
    /** Runs `work` after the settings changes queued before it, one at a time. */
    function queued<T>(work: () => Promise<T>): Promise<T> {
        const next = settingsWrites.then(work);
        settingsWrites = next.then(
            () => undefined,
            () => undefined
        );
        return next;
    }

    /** The saved settings; null when there are none yet. */
    async function readSaved(): Promise<ChatSyncSettings | null> {
        const text = await readOptional(settingsFile);
        if (text === null) return null;
        // Never replaced when unreadable: that would forget private chats and opt-outs.
        const saved = parseJson(text, SettingsSchema);
        if (saved === null) throw new UnreadableSettingsError(settingsFile);
        return saved;
    }

    /** The first settings, saved at once so the machine keeps one id. Only from the queue. */
    async function savedOrCreated(): Promise<ChatSyncSettings> {
        const saved = await readSaved();
        if (saved !== null) return saved;
        const settings: ChatSyncSettings = {
            machineId: randomUUID(),
            noticeShownAt: null,
            sync: 'off',
            syncChosenAt: null,
            projectsOff: [],
            privateChats: [],
        };
        await writeJson(dir, settingsFile, settings);
        return settings;
    }

    return {
        readChatFolder: async (chatId) =>
            (await readJson(folderFile(chatId), ChatFolderSchema))?.folder ?? null,
        writeChatFolder: async (chatId, folder) =>
            writeJson(dir, folderFile(chatId), ChatFolderSchema.parse({ folder })),
        readSettings: async () => (await readSaved()) ?? (await queued(savedOrCreated)),
        writeSettings: (settings) => writeJson(dir, settingsFile, SettingsSchema.parse(settings)),
        updateSettings: (change) =>
            queued(async () => {
                const settings = change(await savedOrCreated());
                await writeJson(dir, settingsFile, SettingsSchema.parse(settings));
                return settings;
            }),
        readChat: async (account, chatId) => readJson(chatFile(account, chatId), ChatStateSchema),
        writeChat: async (account, chatId, state) =>
            writeJson(dir, chatFile(account, chatId), ChatStateSchema.parse(state)),
        async forgetChat(account, chatId) {
            await rm(chatFile(account, chatId), { force: true });
        },
        async readAccount(account) {
            const file = path.join(accountDir(account), 'account.json');
            return (
                (await readJson(file, AccountStateSchema)) ?? {
                    chatLimitUntil: null,
                    pendingDeletes: [],
                }
            );
        },
        async listAccounts() {
            try {
                const entries = await readdir(dir, { withFileTypes: true });
                return entries
                    .filter(
                        (entry) =>
                            entry.isDirectory() &&
                            entry.name !== 'folders' &&
                            ACCOUNT_KEY.test(entry.name)
                    )
                    .map((entry) => entry.name);
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
                throw error;
            }
        },
        writeAccount: async (account, state) =>
            writeJson(
                dir,
                path.join(accountDir(account), 'account.json'),
                AccountStateSchema.parse(state)
            ),
    };
}

/** Sync is on everywhere: the person turned it on themselves. Off is the default. */
export function syncIsOn(settings: ChatSyncSettings): boolean {
    return settings.sync === 'on' && settings.syncChosenAt !== null;
}

/**
 * The settings say this chat may sync: sync on, its folder not opted out, neither it nor a chat it
 * was forked from private.
 */
export function syncAllowed(
    settings: ChatSyncSettings,
    chat: {
        readonly id: string;
        readonly cwd: string | null;
        readonly parentIds: readonly string[];
    }
): boolean {
    if (!syncIsOn(settings)) return false;
    if ([chat.id, ...chat.parentIds].some((id) => settings.privateChats.includes(id))) return false;
    const cwd = chat.cwd;
    return cwd === null || !settings.projectsOff.some((folder) => isInside(cwd, folder));
}

/** Whether `child` is `parent` or a folder inside it. */
export function isInside(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
}

async function readJson<Schema extends z.ZodType>(
    file: string,
    schema: Schema
): Promise<z.output<Schema> | null> {
    const text = await readOptional(file);
    // A file another version wrote, or one cut short, starts that state over.
    return text === null ? null : parseJson(text, schema);
}

async function readOptional(file: string): Promise<string | null> {
    try {
        return await readFile(file, 'utf8');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
    }
}

function parseJson<Schema extends z.ZodType>(
    text: string,
    schema: Schema
): z.output<Schema> | null {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return null;
    }
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : null;
}

/** Writes through a temporary file, so a reader never sees half of it; 0600 in 0700 folders. */
async function writeJson(root: string, file: string, value: unknown): Promise<void> {
    await mkdir(root, { mode: 0o700, recursive: true });
    await chmod(root, 0o700);
    await mkdir(path.dirname(file), { mode: 0o700, recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 4)}\n`, { mode: 0o600 });
    await rename(temporary, file);
}
