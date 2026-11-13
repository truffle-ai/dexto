// What chat sync says to the person: the first-run notice and the /sync and /private replies.
// The exact words are reviewed with the product owner (DEXTO-2377); change them there first.

import { SYNCED_CHAT_LIMIT, type CloudDelete } from './engine.js';

const HOW_TO_TURN_OFF = [
    'To keep chats on this machine:',
    '  /private               this chat',
    '  /sync off project      every chat in this folder',
    '  /sync off              every chat, everywhere',
].join('\n');

/** Shown once, before any chat syncs. */
export function firstRunNotice(input: { readonly canSync: boolean }): string {
    return [
        'Chat sync is on. Your chats here are also saved to your Dexto Cloud account, where only you can see them, so you can find them later and continue them in the cloud.',
        '',
        "What syncs: what you and the agent say, and each tool call with up to 4,000 characters of its input and output, plus the chat's folder, git branch and this computer's name. Before anything leaves this machine, API keys, tokens and passwords are replaced with [redacted], and the contents of files such as .env and ~/.ssh keys are never sent. Attachments sync as their name and size only.",
        '',
        'Deleting a chat here deletes its synced copy too. You can also delete synced chats in Dexto Cloud.',
        '',
        HOW_TO_TURN_OFF,
        ...(input.canSync
            ? []
            : ['', 'Your sign-in is from before chat sync. Run /login once to let chats sync.']),
    ].join('\n');
}

export type SyncStatus =
    | { readonly kind: 'signed_out' }
    | { readonly kind: 'needs_login' }
    | { readonly kind: 'off_everywhere' }
    | { readonly kind: 'off_in_project'; readonly folder: string }
    | { readonly kind: 'private' }
    | {
          readonly kind: 'stopped';
          readonly reason: 'sync_diverged' | 'chat_full' | 'deleted_in_cloud';
      }
    | { readonly kind: 'on'; readonly limitReached: boolean };

/** The reply to /sync: where this chat stands, and how to change it. */
export function statusText(status: SyncStatus): string {
    switch (status.kind) {
        case 'signed_out':
            return 'Chat sync is off: you are not signed in to Dexto. Run /login to sync your chats.';
        case 'needs_login':
            return 'Chat sync is on, but your sign-in is from before chat sync. Run /login once to let chats sync.';
        case 'off_everywhere':
            return 'Chat sync is off for every chat. Turn it on with /sync on.';
        case 'off_in_project':
            return `Chat sync is off for chats in ${status.folder}. Turn it on with /sync on project.`;
        case 'private':
            return 'This chat is private: it stays on this machine. Let it sync with /private off.';
        case 'stopped':
            return stoppedText(status.reason);
        case 'on':
            return [
                'This chat syncs to your Dexto Cloud account, where only you can see it.',
                ...(status.limitReached
                    ? [
                          `You have reached the ${SYNCED_CHAT_LIMIT.toLocaleString('en-US')} synced chats Dexto Cloud keeps for you, so new chats stay on this machine until you delete some synced chats.`,
                      ]
                    : []),
                '',
                HOW_TO_TURN_OFF,
            ].join('\n');
    }
}

function stoppedText(reason: 'sync_diverged' | 'chat_full' | 'deleted_in_cloud'): string {
    switch (reason) {
        case 'sync_diverged':
            return 'This chat stopped syncing: it no longer matches its copy in Dexto Cloud, which keeps what synced before.';
        case 'chat_full':
            return 'This chat stopped syncing: its copy in Dexto Cloud holds as much as a synced chat can. It keeps everything on this machine.';
        case 'deleted_in_cloud':
            return 'This chat stopped syncing: its copy was deleted in Dexto Cloud. New chats still sync.';
    }
}

export const USAGE = {
    sync: 'Usage: /sync, /sync on, /sync off, /sync on project, /sync off project',
    private: 'Usage: /private, /private off',
} as const;

export const REPLIES = {
    syncOn: 'Chat sync is on. Your chats sync to your Dexto Cloud account.',
    syncOnSignedOut: 'You are not signed in to Dexto. Run /login to start syncing.',
    syncOnNeedsLogin:
        'Chat sync is on. Your sign-in is from before chat sync: run /login once to let chats sync.',
    syncOff:
        'Chat sync is off for every chat. Chats already synced keep their copies in Dexto Cloud; delete them there, or use /private in a chat to delete its copy.',
    projectOn: (folder: string) => `Chat sync is on for chats in ${folder}.`,
    projectOnStillOff: (folder: string) =>
        `Chat sync is on for chats in ${folder}, but it is still off everywhere. Turn it on with /sync on.`,
    projectOff: (folder: string) =>
        `Chat sync is off for chats in ${folder}. Chats already synced keep their copies in Dexto Cloud; use /private in a chat to delete its copy.`,
    madePrivate:
        'This chat is private: it stays on this machine, and its copy in Dexto Cloud is deleted.',
    madePrivateNeverSynced:
        'This chat is private: it stays on this machine. It had not synced, so Dexto Cloud has no copy.',
    madePrivateDeleteLater:
        'This chat is private: it stays on this machine. Its copy in Dexto Cloud is deleted as soon as the CLI can reach Dexto Cloud while you are signed in.',
    madePrivateInCloud:
        'This chat is private here, but it continues in Dexto Cloud, so its copy there was not deleted. Delete it in Dexto Cloud.',
    madeShared: 'This chat syncs again, as a new chat in Dexto Cloud.',
    noChat: 'There is no chat yet to make private. To keep new chats on this machine, use /sync off project or /sync off.',
} as const;

/** What `dexto chat delete` says about the chat's copy in Dexto Cloud; null when nothing to say. */
export function deletedCopyText(outcome: CloudDelete): string | null {
    switch (outcome) {
        case 'none':
            return null;
        case 'deleted':
            return 'Its synced copy in Dexto Cloud is deleted too.';
        case 'pending':
            return 'Its synced copy in Dexto Cloud is deleted as soon as the CLI can reach Dexto Cloud while you are signed in.';
        case 'in_cloud':
            return 'It continues in Dexto Cloud, so its copy there was not deleted. Delete it in Dexto Cloud.';
    }
}
