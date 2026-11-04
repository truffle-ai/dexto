// Runs chat sync beside the interactive CLI: syncs a chat after each run, shows the first-run
// notice before anything syncs, and answers /sync and /private.

import { createChatSync, type ChatSync, type ChatSyncDeps, type SyncConnection } from './engine.js';
import { firstRunNotice, REPLIES, statusText, USAGE, type SyncStatus } from './notices.js';
import { isInside, syncAllowed, type ChatSyncStore } from './store.js';

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
    const waiting: string[] = [];
    let listener: ((text: string) => void) | null = null;
    const notify = (text: string) => {
        if (listener === null) waiting.push(text);
        else listener(text);
    };

    const engine = createChatSync({
        ...deps,
        connect: async () => {
            const signIn = await deps.signIn();
            return signIn.kind === 'ready' ? signIn.connection : null;
        },
        note: notify,
    });

    /** The first-run notice, once, as soon as someone signed in has sync on. */
    async function noticeIfDue(): Promise<void> {
        const settings = await deps.store.readSettings();
        if (settings.noticeShownAt !== null || settings.sync === 'off') return;
        const signIn = await deps.signIn();
        if (signIn.kind === 'signed_out') return;
        notify(firstRunNotice({ canSync: signIn.kind === 'ready' }));
        await markNoticeShown(deps.store, deps.now());
    }

    async function syncAfterNotice(chatId: string): Promise<void> {
        await noticeIfDue();
        await engine.sync(chatId);
    }

    // Sync never fails a run: a failure here is retried after the next one.
    const unsubscribe = deps.onRunComplete((chatId) =>
        syncAfterNotice(chatId).catch(() => undefined)
    );

    async function status(chatId: string | null): Promise<SyncStatus> {
        const settings = await deps.store.readSettings();
        if (settings.sync === 'off') return { kind: 'off_everywhere' };
        if (chatId !== null && settings.privateChats.includes(chatId)) return { kind: 'private' };
        if (!syncAllowed(settings, { id: chatId ?? '', cwd: deps.cwd }))
            return {
                kind: 'off_in_project',
                folder: optedOutFolder(settings.projectsOff, deps.cwd),
            };
        const signIn = await deps.signIn();
        if (signIn.kind !== 'ready') return { kind: signIn.kind };
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
        const settings = await deps.store.readSettings();
        const on = setting === 'on';
        let reply: string;
        if (scope === 'project') {
            // On: every opted-out folder holding this one syncs again, so name them.
            const holding = settings.projectsOff.filter((folder) => isInside(deps.cwd, folder));
            await deps.store.writeSettings({
                ...settings,
                projectsOff: on
                    ? settings.projectsOff.filter((folder) => !holding.includes(folder))
                    : [...new Set([...settings.projectsOff, deps.cwd])],
            });
            const folders = holding.length === 0 ? deps.cwd : holding.join(', ');
            reply = !on
                ? REPLIES.projectOff(deps.cwd)
                : settings.sync === 'off'
                  ? REPLIES.projectOnStillOff(folders)
                  : REPLIES.projectOn(folders);
        } else {
            await deps.store.writeSettings({ ...settings, sync: on ? 'on' : 'off' });
            if (!on) return REPLIES.syncOff;
            // Turning sync on is the person's own choice: no first-run notice after it.
            await markNoticeShown(deps.store, deps.now());
            reply =
                (await deps.signIn()).kind === 'needs_login'
                    ? REPLIES.syncOnNeedsLogin
                    : REPLIES.syncOn;
        }
        if (on && chatId !== null) await engine.sync(chatId);
        return reply;
    }

    async function privacy(args: readonly string[], chatId: string | null): Promise<string> {
        if (args.length > 1 || (args.length === 1 && args[0] !== 'off')) return USAGE.private;
        if (chatId === null) return REPLIES.noChat;
        if (args[0] === 'off') {
            await engine.makeShared(chatId);
            await syncAfterNotice(chatId);
            return REPLIES.madeShared;
        }
        await engine.makePrivate(chatId);
        return REPLIES.madePrivate;
    }

    return {
        engine,
        async start(chatId) {
            await noticeIfDue();
            await engine.sendPendingDeletes();
            if (chatId !== null) await engine.sync(chatId);
        },
        command: (name, args, chatId) =>
            name === 'sync' ? sync(args, chatId) : privacy(args, chatId),
        onNotice(next) {
            listener = next;
            for (const text of waiting.splice(0)) next(text);
            return () => {
                if (listener === next) listener = null;
            };
        },
        stop: unsubscribe,
    };
}

async function markNoticeShown(store: ChatSyncStore, now: number): Promise<void> {
    const settings = await store.readSettings();
    if (settings.noticeShownAt === null)
        await store.writeSettings({ ...settings, noticeShownAt: new Date(now).toISOString() });
}

/** The opted-out folder holding `cwd`, for the reply that names it. */
function optedOutFolder(projectsOff: readonly string[], cwd: string): string {
    const holding = projectsOff.filter((folder) => isInside(cwd, folder));
    return holding.sort((a, b) => a.length - b.length)[0] ?? cwd;
}
