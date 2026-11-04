// Chat sync on this machine: sign-ins under ~/.dexto/accounts, state under ~/.dexto/chat-sync,
// chats from the running agent.

import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { dextoGateway } from '@dexto/agent-management';
import { createCloudClient } from '@dexto/cloud-client';
import { getDextoGlobalPath, type DextoAgent } from '@dexto/core';
import { resolveConnection } from '../cloud/connection.js';
import { createChatSync, type ChatSync, type LocalChat } from './engine.js';
import { CHAT_SYNC_SCOPE, createChatSyncHost, type ChatSyncHost, type SyncSignIn } from './host.js';
import { chatSyncStore, type ChatSyncStore } from './store.js';

const NO_OVERRIDES = { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null } as const;

export function nodeChatSyncStore(): ChatSyncStore {
    return chatSyncStore(getDextoGlobalPath('chat-sync'));
}

/**
 * The person's sign-in, for syncing: only a saved sign-in syncs, never a key from a flag or
 * DEXTO_API_KEY, and only with the chats:sync scope. Read for every request, so signing out
 * stops sync at once.
 */
async function nodeSignIn(): Promise<SyncSignIn> {
    const gateway = dextoGateway.defaultDextoGatewayOptions();
    let connection;
    try {
        connection = await resolveConnection({
            dir: getDextoGlobalPath('accounts'),
            environment: process.env,
            overrides: NO_OVERRIDES,
            refresh: gateway.refresh,
        });
    } catch {
        // A sign-in that can't be read or refreshed doesn't sync.
        return { kind: 'signed_out' };
    }
    if (connection === null || connection.kind !== 'oauth' || connection.source !== 'login')
        return { kind: 'signed_out' };
    if (!connection.login.scopes.includes(CHAT_SYNC_SCOPE)) return { kind: 'needs_login' };
    const who = connection.login.signedInAs;
    const account =
        who === null
            ? `profile-${connection.profile}`
            : `${who.organization.id}-${who.account.id}`.replaceAll(/[^A-Za-z0-9_-]/gu, '_');
    return {
        kind: 'ready',
        connection: {
            account: account.slice(0, 128),
            signInId: connection.login.savedAt,
            // Synced chats belong to the person, not a Cloud project.
            // The sign-in's own API, never one an environment variable names instead.
            client: createCloudClient({
                apiBaseUrl: connection.login.apiBaseUrl,
                token: connection.token,
                cloudProject: null,
            }),
        },
    };
}

const common = () => ({
    store: nodeChatSyncStore(),
    now: () => Date.now(),
    machineName: hostname(),
    cliVersion: process.env.DEXTO_CLI_VERSION ?? 'unknown',
});

/** Chat sync for the interactive CLI on `agent`, working in `cwd`. */
export async function startNodeChatSync(
    agent: Pick<DextoAgent, 'on' | 'getSessionHistory' | 'getSessionMetadata'>,
    cwd: string
): Promise<ChatSyncHost> {
    const gitBranch = await currentGitBranch(cwd);
    const store = nodeChatSyncStore();
    const readChat = async (chatId: string): Promise<LocalChat | null> => {
        const metadata = await agent.getSessionMetadata(chatId);
        if (metadata === undefined) return null;
        const parentIds = await forkedFrom(agent, metadata.parentSessionId);
        const messages = await agent.getSessionHistory(chatId, { expandBlobReferences: false });
        return {
            id: chatId,
            title: metadata.title ?? null,
            cwd: await chatFolder(store, [chatId, ...parentIds], cwd),
            gitBranch,
            messages,
            parentIds,
        };
    };
    let host: ChatSyncHost | null = null;
    host = createChatSyncHost({
        ...common(),
        store,
        signIn: nodeSignIn,
        readChat,
        cwd,
        schedule: (ms, chatId) => {
            setTimeout(() => void host?.engine.sync(chatId).catch(() => undefined), ms).unref();
        },
        onRunComplete: (listener) => {
            const controller = new AbortController();
            agent.on(
                'run:complete',
                (payload) => {
                    void listener(payload.sessionId);
                },
                { signal: controller.signal }
            );
            return () => controller.abort();
        },
    });
    return host;
}

/** Chat sync without a running chat: for deleting a local chat's cloud copy. */
export function nodeChatSync(note: (text: string) => void): ChatSync {
    return createChatSync({
        ...common(),
        connect: async () => {
            const signIn = await nodeSignIn();
            return signIn.kind === 'ready' ? signIn.connection : null;
        },
        readChat: async () => null,
        note,
        schedule: () => undefined,
    });
}

/** The chats a chat was forked from, nearest first. */
async function forkedFrom(
    agent: Pick<DextoAgent, 'getSessionMetadata'>,
    parentId: string | undefined
): Promise<string[]> {
    const ids: string[] = [];
    let next = parentId;
    while (next !== undefined && !ids.includes(next) && ids.length < 50) {
        ids.push(next);
        next = (await agent.getSessionMetadata(next))?.parentSessionId;
    }
    return ids;
}

/**
 * The folder a chat works in: the one kept for it (or for the chat it was forked from), else the
 * folder the CLI runs in, kept from now on. A chat resumed elsewhere keeps its own folder, so its
 * folder's opt-out still applies.
 */
async function chatFolder(
    store: ChatSyncStore,
    ids: readonly string[],
    cwd: string
): Promise<string> {
    for (const id of ids) {
        const folder = await store.readChatFolder(id);
        if (folder !== null) return folder;
    }
    const [chatId] = ids;
    if (chatId !== undefined) await store.writeChatFolder(chatId, cwd);
    return cwd;
}

async function currentGitBranch(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await promisify(execFile)('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd,
            timeout: 2_000,
        });
        const branch = stdout.trim();
        return branch === '' || branch === 'HEAD' ? null : branch;
    } catch {
        return null;
    }
}
