// Runs chat sync beside the interactive CLI: syncs a chat after each run, shows the first-run
// notice before anything syncs, and answers /sync and /private.

import {
    createChatSync,
    type ChatSync,
    type ChatSyncDeps,
    type CloudDelete,
    type SyncConnection,
} from './engine.js';
import { firstRunNotice, REPLIES, statusText, USAGE, type SyncStatus } from './notices.js';
import { isInside, syncAllowed, UnreadableSettingsError, type ChatSyncStore } from './store.js';

/** The scope a sign-in needs to sync chats; asked for at sign-in only while sync is on. */
export const CHAT_SYNC_SCOPE = 'chats:sync';

/** Whether the person can sync now. */
export type SyncSignIn =
    | { readonly kind: 'signed_out' }
    /** Signed in without the chats:sync scope. */
    | { readonly kind: 'needs_login' }
    | { readonly kind: 'ready'; readonly connection: SyncConnection };

export interface ChatSyncHostDeps extends Omit<ChatSyncDeps, 'connect' | 'note'> {
    readonly signIn: () => Promise<SyncSignIn>;
    /** The folder the CLI works in: /sync on|off project acts on it. */
    readonly cwd: string;
    /** Calls `listener` with each run that finished, by chat; returns the unsubscribe. */
    readonly onRunComplete: (listener: (chatId: string) => Promise<void>) => () => void;
}

export interface ChatSyncHost {
    readonly engine: ChatSync;
    /** Shows the notice if due, sends deletes left from before, and syncs the chat. */
    readonly start: (chatId: string | null) => Promise<void>;
    readonly command: (
        name: 'sync' | 'private',
        args: readonly string[],
        chatId: string | null
    ) => Promise<string>;
    readonly onNotice: (listener: (text: string) => void) => () => void;
    readonly stop: () => void;
}

export function createChatSyncHost(deps: ChatSyncHostDeps): ChatSyncHost {
    /** Notices the screen hasn't shown yet, each with what to do once it has. */
    const waiting: { text: string; shown: () => Promise<void> }[] = [];
    let listener: ((text: string) => void) | null = null;
    const notify = async (
        text: string,
        shown: () => Promise<void> = async () => undefined
    ): Promise<void> => {
        if (listener === null) {
            waiting.push({ text, shown });
            return;
        }
        listener(text);
        await shown();
    };
    let noticeQueued = false;
    let unreadableNoted = false;
    /** Sync never fails a run; settings it can't read are said once, so the person knows why. */
    const quietly = (work: Promise<void>): Promise<void> =>
        work.catch((error: unknown) => {
            if (!(error instanceof UnreadableSettingsError) || unreadableNoted) return;
            unreadableNoted = true;
            void notify(error.message).catch(() => undefined);
        });

    const engine = createChatSync({
        ...deps,
        connect: async () => {
            const signIn = await deps.signIn();
            return signIn.kind === 'ready' ? signIn.connection : null;
        },
        note: (text) => void notify(text),
    });

    /**
     * The first-run notice, once, as soon as someone signed in has sync on. It counts as shown
     * when the screen shows it, and nothing syncs before that.
     */
    async function noticeIfDue(): Promise<void> {
        if (noticeQueued) return;
        const settings = await deps.store.readSettings();
        if (settings.noticeShownAt !== null || settings.sync === 'off') return;
        const signIn = await deps.signIn();
        if (signIn.kind === 'signed_out') return;
        noticeQueued = true;
        await notify(firstRunNotice({ canSync: signIn.kind === 'ready' }), () =>
            markNoticeShown(deps.store, deps.now())
        );
    }

    async function syncAfterNotice(chatId: string): Promise<void> {
        await noticeIfDue();
        await engine.sync(chatId);
    }

    const unsubscribe = deps.onRunComplete((chatId) => quietly(syncAfterNotice(chatId)));

    async function status(chatId: string | null): Promise<SyncStatus> {
        const settings = await deps.store.readSettings();
        if (settings.sync === 'off') return { kind: 'off_everywhere' };
        const chat = chatId === null ? null : await deps.readChat(chatId);
        const ids = chat === null ? [] : [chat.id, ...chat.parentIds];
        if (ids.some((id) => settings.privateChats.includes(id))) return { kind: 'private' };
        const cwd = chat?.cwd ?? deps.cwd;
        if (!syncAllowed(settings, { id: '', cwd, parentIds: [] }))
            return { kind: 'off_in_project', folder: optedOutFolder(settings.projectsOff, cwd) };
        const signIn = await deps.signIn();
        if (signIn.kind !== 'ready') return { kind: signIn.kind };
        const saved =
            chatId === null ? null : await deps.store.readChat(signIn.connection.account, chatId);
        if (saved?.status === 'stopped') return { kind: 'stopped', reason: saved.reason };
        const account = await deps.store.readAccount(signIn.connection.account);
        const limitReached =
            account.chatLimitUntil !== null && deps.now() < Date.parse(account.chatLimitUntil);
        return { kind: 'on', limitReached };
    }

    async function sync(args: readonly string[], chatId: string | null): Promise<string> {
        const [setting, scope, ...rest] = args;
        if (args.length === 0) return statusText(await status(chatId));
        if ((setting !== 'on' && setting !== 'off') || rest.length > 0) return USAGE.sync;
        if (scope !== undefined && scope !== 'project') return USAGE.sync;
        const on = setting === 'on';
        let reply: string;
        if (scope === 'project') {
            // The chat's own folder: a chat resumed elsewhere keeps the folder it started in.
            const folder =
                (chatId === null ? null : (await deps.readChat(chatId))?.cwd) ?? deps.cwd;
            let holding: string[] = [];
            const settings = await deps.store.updateSettings((current) => {
                // On: every opted-out folder holding this one syncs again, so name them.
                holding = current.projectsOff.filter((off) => isInside(folder, off));
                return {
                    ...current,
                    projectsOff: on
                        ? current.projectsOff.filter((off) => !holding.includes(off))
                        : [...new Set([...current.projectsOff, folder])],
                };
            });
            const folders = holding.length === 0 ? folder : holding.join(', ');
            reply = !on
                ? REPLIES.projectOff(folder)
                : settings.sync === 'off'
                  ? REPLIES.projectOnStillOff(folders)
                  : REPLIES.projectOn(folders);
        } else {
            await deps.store.updateSettings((current) => ({
                ...current,
                sync: on ? 'on' : 'off',
            }));
            if (!on) return REPLIES.syncOff;
            // Turning sync on is the person's own choice: no first-run notice after it.
            await markNoticeShown(deps.store, deps.now());
            reply =
                (await deps.signIn()).kind === 'needs_login'
                    ? REPLIES.syncOnNeedsLogin
                    : REPLIES.syncOn;
        }
        // The setting is saved: the reply doesn't wait for a whole chat to upload.
        if (on && chatId !== null) void quietly(engine.sync(chatId));
        return reply;
    }

    async function privacy(args: readonly string[], chatId: string | null): Promise<string> {
        if (args.length > 1 || (args.length === 1 && args[0] !== 'off')) return USAGE.private;
        if (chatId === null) return REPLIES.noChat;
        if (args[0] === 'off') {
            await engine.makeShared(chatId);
            void quietly(syncAfterNotice(chatId));
            return REPLIES.madeShared;
        }
        return madePrivateReply(await engine.makePrivate(chatId));
    }

    async function start(chatId: string | null): Promise<void> {
        // On the launch that shows the notice, nothing syncs until the next run ends, so the
        // person can first keep this chat, or this folder, on this machine.
        const noticeWasShown = (await deps.store.readSettings()).noticeShownAt !== null;
        await noticeIfDue();
        await engine.sendPendingDeletes();
        if (noticeWasShown && chatId !== null) await engine.sync(chatId);
    }

    return {
        engine,
        start: (chatId) => quietly(start(chatId)),
        command: (name, args, chatId) =>
            name === 'sync' ? sync(args, chatId) : privacy(args, chatId),
        onNotice(next) {
            listener = next;
            for (const { text, shown } of waiting.splice(0)) {
                next(text);
                void shown().catch(() => undefined);
            }
            return () => {
                if (listener === next) listener = null;
            };
        },
        stop: unsubscribe,
    };
}

async function markNoticeShown(store: ChatSyncStore, now: number): Promise<void> {
    await store.updateSettings((settings) => ({
        ...settings,
        noticeShownAt: settings.noticeShownAt ?? new Date(now).toISOString(),
    }));
}

export function madePrivateReply(outcome: CloudDelete): string {
    switch (outcome) {
        case 'none':
            return REPLIES.madePrivateNeverSynced;
        case 'deleted':
            return REPLIES.madePrivate;
        case 'pending':
            return REPLIES.madePrivateDeleteLater;
        case 'in_cloud':
            return REPLIES.madePrivateInCloud;
    }
}

/** The opted-out folder holding `cwd`, for the reply that names it. */
function optedOutFolder(projectsOff: readonly string[], cwd: string): string {
    const holding = projectsOff.filter((folder) => isInside(cwd, folder));
    return holding.sort((a, b) => a.length - b.length)[0] ?? cwd;
}
