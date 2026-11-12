import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { CloudApiError, createCloudClient, unwrap } from '@dexto/cloud-client';
import { getDextoGlobalPath } from '@dexto/core';
import { CommandFailure } from '../../failure.js';
import {
    argument,
    choiceOption,
    flag,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { nodeChatSyncStore, startNodeChatSync } from '../../chat-sync/node.js';
import {
    buildWorkingTree,
    readLocalTreeCheckpoint,
    type WorkingTree,
} from '../../chat-sync/working-tree.js';
import { requireConsent } from '../../interaction.js';
import { formatBytes } from './files.js';
import {
    applyReturnedTree,
    assertLocalTreeMatches,
    recoverAbandonedReturn,
    ReturnCheckpointSchema,
} from '../../chat-sync/return-tree.js';
import {
    cancelMove,
    CloudMoveFailure,
    type ChatMove,
    describeObject,
    downloadMoveObject,
    moveToCloud,
    startLocalReturn,
    transientRetryDelay,
    waitForMove,
    type MoveTransport,
} from '../../chat-sync/move.js';
import { resumeTranscript } from '../../chat-sync/resume.js';
import { toSyncedMessages } from '../../chat-sync/messages.js';
import { queryWorkspaceTool } from './workspace.js';
import { chatMoveScreen } from '../../screens/chat-move.js';

async function localChat(context: CommandContext, id: string) {
    if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(id)) throw new UsageError('Invalid local chat id.');
    const connection = await context.connection();
    if (connection.kind !== 'oauth' || connection.source !== 'login')
        throw new CommandFailure(
            'needs_sign_in',
            'Chat hand-off needs your saved OAuth sign-in.',
            'dexto login'
        );
    if (!connection.login.scopes.includes('chats:sync'))
        throw new CommandFailure(
            'needs_permission',
            'Chat hand-off needs chats:sync permission.',
            'dexto login'
        );
    const who = connection.login.signedInAs;
    const account = (
        who === null
            ? `profile-${connection.profile}`
            : `${who.organization.id}-${who.account.id}`.replaceAll(/[^A-Za-z0-9_-]/gu, '_')
    ).slice(0, 128);
    const store = nodeChatSyncStore();
    const state = await store.readChat(account, id);
    if (state === null || state.status === 'stopped' || state.cloudChatId === null)
        throw new CommandFailure(
            'invalid_input',
            'This local chat has not synced. Open it and let it sync before moving it.',
            null
        );
    const cwd = await store.readChatFolder(id);
    if (cwd === null)
        throw new CommandFailure('invalid_input', 'This chat has no saved working folder.', null);
    const client = createCloudClient({
        apiBaseUrl: connection.login.apiBaseUrl,
        token: connection.token,
        cloudProject: null,
        fetch: context.runtime.fetch,
    });
    const transport: MoveTransport = {
        client,
        fetch: context.runtime.fetch,
        signal: context.runtime.signal,
        sleep: context.runtime.sleep,
    };
    const file = path.join(getDextoGlobalPath('chat-sync'), 'moves', account, `${id}.json`);
    const save = async (checkpoint: z.output<typeof ReturnCheckpointSchema>) => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(checkpoint), { mode: 0o600 });
        await rename(temporary, file);
    };
    return {
        account,
        signInId: connection.login.savedAt,
        store,
        state,
        cwd,
        transport,
        file,
        save,
        cloudId: state.cloudChatId,
    };
}

function describeHandOff(tree: WorkingTree) {
    return {
        repository: tree.repository,
        branch: tree.branch,
        changedFiles: tree.changedFiles,
        totalBytes: tree.bundle.byteLength + (tree.patch?.byteLength ?? 0),
    };
}

function handOffSummary(tree: WorkingTree): string {
    const plan = describeHandOff(tree);
    const files = plan.changedFiles === 1 ? 'file' : 'files';
    return `Upload ${plan.repository} (branch ${plan.branch}, ${plan.changedFiles} changed or untracked ${files}, ${formatBytes(plan.totalBytes)}) to the cloud computer.`;
}

/**
 * Uploading a working tree needs consent. JSON and non-interactive runs never prompt, so they need
 * --yes; a terminal run prints the summary and asks y/N.
 */
async function confirmUpload(
    context: CommandContext,
    input: CommandInput,
    tree: WorkingTree
): Promise<void> {
    const summary = handOffSummary(tree);
    if (flag(input, 'yes')) {
        if (!context.output.json) context.runtime.writeError(`${summary}\n`);
        return;
    }
    await requireConsent(
        context.output.json ? { ...context, runtime: { prompt: null } } : context,
        false,
        summary
    );
}

async function readReturnCheckpoint(file: string, id: string) {
    try {
        return ReturnCheckpointSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            throw new CommandFailure(
                'invalid_input',
                'This local chat has no saved cloud hand-off. Move it to cloud before bringing it back.',
                `dexto chat move ${id} --to cloud`
            );
        throw error;
    }
}

const move: Command = {
    path: ['chat', 'move'],
    arguments: '<id>',
    summary:
        'Move a synced local chat and working tree to cloud or local (beta). Current Git LFS objects travel with the working tree within the hand-off size limit.',
    options: {
        'dry-run': {
            type: 'boolean',
            description:
                'Inspect the hand-off plan without syncing, uploading, applying or moving the chat.',
        },
        to: { type: 'string', valueName: 'cloud|local', description: 'Where the chat continues.' },
        detach: {
            type: 'boolean',
            description: 'Return after moving to cloud instead of watching.',
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const id = argument(input, 0, 'local chat id');
        const to = choiceOption(input, 'to', ['cloud', 'local']);
        if (to === undefined) throw new UsageError('--to cloud|local is required.');
        const chat = await localChat(context, id);
        if (flag(input, 'dry-run')) {
            if (to === 'local') {
                context.output.record({
                    dryRun: true,
                    id,
                    to,
                    folder: chat.cwd,
                    steps: [
                        'export cloud work',
                        'verify and apply',
                        'resume transcript',
                        'complete move',
                    ],
                });
                return;
            }
            const tree = await buildWorkingTree(chat.cwd);
            try {
                context.output.record({
                    dryRun: true,
                    id,
                    to,
                    ...describeHandOff(tree),
                    headCommit: tree.head_commit,
                    bundle: describeObject(tree.bundle),
                    patch: tree.patch === null ? null : describeObject(tree.patch),
                });
            } finally {
                await tree.cleanup();
            }
            return;
        }
        if (to === 'cloud') await toCloud(context, input, id, chat);
        else await toLocal(context, id, chat);
    },
};

type SyncedLocalChat = Awaited<ReturnType<typeof localChat>>;

async function toCloud(
    context: CommandContext,
    input: CommandInput,
    id: string,
    initialChat: SyncedLocalChat
): Promise<void> {
    let chat = initialChat;
    if (chat.state.status === 'paused' && chat.state.reason === 'chat_in_cloud') {
        context.output.result(
            { id, location: 'cloud', alreadyThere: true },
            chatMoveScreen(id, 'cloud')
        );
        if (!flag(input, 'detach') && !context.output.json) await watchChat(context, chat.cloudId);
        return;
    }
    if (context.syncLocalChat !== undefined) {
        await context.syncLocalChat(id);
    } else if (context.openLocalAgent !== undefined) {
        // Flush the last local turn before the server records the transcript return cursor.
        const agent = await context.openLocalAgent();
        const sync = await startNodeChatSync(agent, chat.cwd, async () => ({
            kind: 'ready',
            connection: {
                account: chat.account,
                signInId: chat.signInId,
                client: chat.transport.client,
            },
        }));
        try {
            await sync.engine.sync(id);
        } finally {
            sync.stop();
        }
    }
    chat = await localChat(context, id);
    context.runtime.signal.throwIfAborted();
    const { transport, cloudId, state, store, account } = chat;
    if (state.status === 'paused') {
        const pending = await readReturnCheckpoint(chat.file, id);
        if (pending.phase !== 'cloud')
            throw new Error('Finish this return with --to local before moving to cloud again.');
        await assertLocalTreeMatches(chat.cwd, pending);
    }
    if (context.openLocalAgent !== undefined) {
        const agent = await context.openLocalAgent();
        const count = toSyncedMessages(await agent.getSessionHistory(id)).length;
        if (state.sentCount !== count)
            throw new Error(
                'The last local messages have not synced yet. Try again once sync finishes.'
            );
    }
    const tree = await buildWorkingTree(chat.cwd);
    try {
        await confirmUpload(context, input, tree);
        await chat.save({
            branch: tree.branch,
            head: tree.head_commit,
            patchHash: describeObject(tree.patch ?? Buffer.alloc(0)).sha256,
            phase: 'cloud',
        });
        await store.writeChat(account, id, {
            ...state,
            status: 'paused',
            reason: 'move_in_progress',
            since: new Date().toISOString(),
        });
        try {
            await moveToCloud(transport, cloudId, tree);
        } catch (error) {
            const local =
                error instanceof CloudMoveFailure
                    ? error.ownership === 'local'
                    : state.status !== 'paused' &&
                      error instanceof CloudApiError &&
                      error.status < 500 &&
                      error.code !== 'move_in_progress';
            if (local)
                await store.writeChat(account, id, {
                    status: 'syncing',
                    cloudChatId: cloudId,
                    nextIndex: state.nextIndex,
                    sentCount: state.sentCount,
                });
            const cause = error instanceof CloudMoveFailure ? error.cause : error;
            if (!local && !(cause instanceof CloudApiError))
                throw new CommandFailure(
                    'failed',
                    'The hand-off location is not confirmed; local turns remain paused.',
                    `dexto chat move ${id} --to local`
                );
            throw cause;
        }
        await store.writeChat(account, id, {
            ...state,
            status: 'paused',
            reason: 'chat_in_cloud',
            since: new Date().toISOString(),
        });
    } finally {
        await tree.cleanup();
    }
    context.output.result(
        {
            id,
            location: 'cloud',
            attached: !flag(input, 'detach') && !context.output.json,
            handOff: describeHandOff(tree),
        },
        chatMoveScreen(id, 'cloud')
    );
    if (!flag(input, 'detach') && !context.output.json) await watchChat(context, cloudId);
    return;
}

async function toLocal(context: CommandContext, id: string, chat: SyncedLocalChat): Promise<void> {
    const { transport, cloudId, state, store, account } = chat;
    if (context.openLocalAgent === undefined)
        throw new Error('Local session runtime is unavailable.');
    let checkpoint = await readReturnCheckpoint(chat.file, id);
    let baseline = {
        branch: checkpoint.branch,
        head: checkpoint.head,
        patchHash: checkpoint.patchHash,
    };
    let started: ChatMove;
    try {
        started =
            checkpoint.phase === 'cloud'
                ? await startLocalReturn(transport, cloudId)
                : await unwrap(
                      await transport.client.GET('/v1/synced_chats/{chat_id}/moves/{move_id}', {
                          params: { path: { chat_id: cloudId, move_id: checkpoint.moveId } },
                          signal: transport.signal,
                      })
                  );
    } catch (error) {
        if (
            error instanceof CloudApiError &&
            error.code === 'chat_local' &&
            checkpoint.phase === 'cloud' &&
            state.status === 'paused' &&
            state.reason === 'move_in_progress'
        ) {
            await store.writeChat(account, id, {
                status: 'syncing',
                cloudChatId: cloudId,
                nextIndex: state.nextIndex,
                sentCount: state.sentCount,
            });
            context.output.result(
                { id, location: 'local', alreadyThere: true },
                chatMoveScreen(id, 'local')
            );
            return;
        }
        throw error;
    }
    if (
        started.status === 'expired' ||
        started.status === 'canceled' ||
        started.status === 'failed'
    ) {
        checkpoint = await recoverAbandonedReturn(chat.cwd, checkpoint);
        baseline = {
            branch: checkpoint.branch,
            head: checkpoint.head,
            patchHash: checkpoint.patchHash,
        };
        await chat.save(checkpoint);
        started = await startLocalReturn(transport, cloudId);
    }
    if (checkpoint.phase === 'cloud')
        await chat.save({ ...baseline, phase: 'returning', moveId: started.id });
    if (checkpoint.phase === 'resumed' && started.status === 'completed') {
        if (state.status === 'paused')
            await store.writeChat(account, id, {
                status: 'syncing',
                cloudChatId: cloudId,
                nextIndex: checkpoint.nextIndex,
                sentCount: checkpoint.sentCount,
            });
        context.output.result(
            { id, location: 'local' },
            `◇ Local · ${id} · Resume: dexto -r ${id}`
        );
        return;
    }
    let applied = checkpoint.phase === 'applied' || checkpoint.phase === 'resumed';
    try {
        const ready = await waitForMove(transport, cloudId, started);
        if (ready.status !== 'ready' || ready.export === null)
            throw new Error('The cloud move has no return export.');
        const exported = ready.export;
        if (!applied) {
            let bundle: Buffer | null = null;
            let patch: Buffer | null = null;
            for (const download of exported.downloads) {
                const limit = download.object === 'bundle' ? 256 * 1024 * 1024 : 32 * 1024 * 1024;
                if (download.size_bytes > limit)
                    throw new Error('Cloud export exceeds the hand-off size limit.');
                const bytes = await downloadMoveObject(transport, download);
                if (download.object === 'bundle') bundle = bytes;
                else patch = bytes;
            }
            await applyReturnedTree(chat.cwd, checkpoint, {
                branch: exported.branch,
                head: exported.head_commit,
                bundle,
                patch,
            });
            applied = true;
            checkpoint = {
                ...baseline,
                phase: 'applied',
                moveId: started.id,
                appliedTree: await readLocalTreeCheckpoint(chat.cwd),
            };
            await chat.save(checkpoint);
            transport.signal.throwIfAborted();
        }
        const agent = await context.openLocalAgent();
        const session = await agent.getSession(id);
        if (session === undefined) throw new Error('The local session no longer exists.');
        const known = new Set((await agent.getSessionHistory(id)).map((message) => message.id));
        const transcript = await resumeTranscript(exported.transcript_from_index, {
            sourceChatId: cloudId,
            read: async (from) =>
                unwrap(
                    await transport.client.GET('/v1/synced_chats/{chat_id}/messages', {
                        params: { path: { chat_id: cloudId }, query: { from_index: from } },
                        signal: transport.signal,
                    })
                ),
            append: async (message) => {
                if (known.has(message.id)) return;
                await session.getContextManager().addMessage(message);
                known.add(message.id);
            },
        });
        if (checkpoint.phase !== 'applied' && checkpoint.phase !== 'resumed')
            throw new Error('Expected an applied tree before resuming.');
        const sentCount = toSyncedMessages(await agent.getSessionHistory(id)).length;
        await chat.save({
            ...baseline,
            phase: 'resumed',
            moveId: started.id,
            appliedTree: checkpoint.appliedTree,
            nextIndex: transcript.syncFromIndex,
            sentCount,
        });
        await unwrap(
            await transport.client.POST('/v1/synced_chats/{chat_id}/moves/{move_id}/complete', {
                params: { path: { chat_id: cloudId, move_id: started.id } },
                signal: transport.signal,
            })
        );
        await store.writeChat(account, id, {
            status: 'syncing',
            cloudChatId: cloudId,
            nextIndex: transcript.syncFromIndex,
            sentCount,
        });
        context.output.result(
            {
                id,
                location: 'local',
                transcriptFromIndex: exported.transcript_from_index,
                syncFromIndex: transcript.syncFromIndex,
            },
            chatMoveScreen(id, 'local')
        );
    } catch (error) {
        if (!applied) {
            await cancelMove(transport, cloudId, started.id);
            await chat.save({ ...baseline, phase: 'cloud' });
        }
        throw error;
    }
}

async function watchChat(context: CommandContext, cloudId: string): Promise<void> {
    const schema = z.object({
        messages: z.array(z.object({ id: z.string(), role: z.string(), text: z.string() })),
    });
    let previous = new Map<string, string>();
    let failures = 0;
    try {
        while (!context.runtime.signal.aborted) {
            try {
                const value = await queryWorkspaceTool(context, 'dexto_chat_get', {
                    sessionId: cloudId,
                    limit: 50,
                    roles: ['user', 'assistant'],
                });
                const page = schema.parse(value);
                for (const message of page.messages) {
                    const before = previous.get(message.id);
                    if (before === message.text) continue;
                    const delta =
                        before !== undefined && message.text.startsWith(before)
                            ? message.text.slice(before.length)
                            : message.text;
                    const record = { event: 'message', chatId: cloudId, message, delta };
                    if (context.output.json)
                        context.runtime.writeOutput(JSON.stringify(record) + '\n');
                    else context.output.result(record, `  ${message.role} · ${delta}`);
                }
                previous = new Map(page.messages.map((message) => [message.id, message.text]));
                failures = 0;
                await context.runtime.sleep(2_000);
            } catch (error) {
                if (context.runtime.signal.aborted) return;
                const retry = transientRetryDelay(error, failures);
                if (retry === null) throw error;
                failures += 1;
                await context.runtime.sleep(retry);
            }
        }
    } catch (error) {
        if (!context.runtime.signal.aborted) throw error;
    }
}

const watch: Command = {
    path: ['chat', 'watch'],
    arguments: '<id>',
    summary: 'Attach to the cloud view of a synced local chat; Ctrl-C detaches.',
    async run(context, input) {
        const chat = await localChat(context, argument(input, 0, 'local chat id'));
        await watchChat(context, chat.cloudId);
    },
};

export const chatMoveCommands: readonly Command[] = [move, watch];
