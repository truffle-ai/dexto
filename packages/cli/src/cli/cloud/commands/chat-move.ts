import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { createCloudClient, unwrap } from '@dexto/cloud-client';
import { getDextoGlobalPath } from '@dexto/core';
import { CommandFailure } from '../../failure.js';
import {
    argument,
    choiceOption,
    flag,
    UsageError,
    type Command,
    type CommandContext,
} from '../command.js';
import { nodeChatSyncStore, startNodeChatSync } from '../../chat-sync/node.js';
import { buildWorkingTree } from '../../chat-sync/working-tree.js';
import { applyReturnedTree } from '../../chat-sync/return-tree.js';
import {
    cancelMove,
    describeObject,
    downloadMoveObject,
    moveToCloud,
    waitForMove,
    type MoveTransport,
} from '../../chat-sync/move.js';
import { resumeTranscript } from '../../chat-sync/resume.js';
import { toSyncedMessages } from '../../chat-sync/messages.js';
import { queryWorkspaceTool } from './workspace.js';

const TreeCheckpoint = { branch: z.string(), head: z.string(), patchHash: z.string() };
const CheckpointSchema = z.discriminatedUnion('phase', [
    z.object({ ...TreeCheckpoint, phase: z.literal('cloud') }).strict(),
    z.object({ ...TreeCheckpoint, phase: z.literal('returning'), moveId: z.string() }).strict(),
    z.object({ ...TreeCheckpoint, phase: z.literal('applied'), moveId: z.string() }).strict(),
    z
        .object({
            ...TreeCheckpoint,
            phase: z.literal('resumed'),
            moveId: z.string(),
            nextIndex: z.number().int().nonnegative(),
            sentCount: z.number().int().nonnegative(),
        })
        .strict(),
]);

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
    const save = async (checkpoint: z.output<typeof CheckpointSchema>) => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(checkpoint), { mode: 0o600 });
        await rename(temporary, file);
    };
    return { account, store, state, cwd, transport, file, save, cloudId: state.cloudChatId };
}

const move: Command = {
    path: ['chat', 'move'],
    arguments: '<id>',
    summary: 'Move a synced local chat and working tree to cloud or local (beta).',
    options: {
        to: { type: 'string', valueName: 'cloud|local', description: 'Where the chat continues.' },
        detach: {
            type: 'boolean',
            description: 'Return after moving to cloud instead of watching.',
        },
    },
    async run(context, input) {
        const id = argument(input, 0, 'local chat id');
        const to = choiceOption(input, 'to', ['cloud', 'local']);
        if (to === undefined) throw new UsageError('--to cloud|local is required.');
        if (to === 'cloud' && context.openLocalAgent !== undefined) {
            // Flush the last local turn before the server records the transcript return cursor.
            const agent = await context.openLocalAgent();
            const sync = await startNodeChatSync(agent, process.cwd());
            try {
                await sync.engine.sync(id);
            } finally {
                sync.stop();
            }
        }
        const chat = await localChat(context, id);
        const { transport, cloudId, state, store, account } = chat;
        if (to === 'cloud') {
            if (state.status === 'paused')
                throw new Error('This chat is already moving or on its cloud computer.');
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
                await chat.save({
                    branch: tree.branch,
                    head: tree.head_commit,
                    patchHash: describeObject(tree.patch ?? Buffer.alloc(0)).sha256,
                    phase: 'cloud',
                });
                await moveToCloud(transport, cloudId, tree);
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
                { id, location: 'cloud', attached: !flag(input, 'detach') && !context.output.json },
                `◆ Cloud · ${id}\n  Detach: Ctrl-C · Return: dexto chat move ${id} --to local`
            );
            if (!flag(input, 'detach') && !context.output.json) await watchChat(context, cloudId);
            return;
        }
        if (context.openLocalAgent === undefined)
            throw new Error('Local session runtime is unavailable.');
        const checkpoint = CheckpointSchema.parse(JSON.parse(await readFile(chat.file, 'utf8')));
        const baseline = {
            branch: checkpoint.branch,
            head: checkpoint.head,
            patchHash: checkpoint.patchHash,
        };
        const started =
            checkpoint.phase === 'cloud'
                ? await unwrap(
                      await transport.client.POST('/v1/synced_chats/{chat_id}/moves', {
                          params: { path: { chat_id: cloudId } },
                          body: { to: 'local' },
                          signal: transport.signal,
                      })
                  )
                : await unwrap(
                      await transport.client.GET('/v1/synced_chats/{chat_id}/moves/{move_id}', {
                          params: { path: { chat_id: cloudId, move_id: checkpoint.moveId } },
                          signal: transport.signal,
                      })
                  );
        if (checkpoint.phase === 'cloud')
            await chat.save({ ...baseline, phase: 'returning', moveId: started.id });
        if (checkpoint.phase === 'resumed' && started.status === 'completed') {
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
                    const limit =
                        download.object === 'bundle' ? 256 * 1024 * 1024 : 32 * 1024 * 1024;
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
                await chat.save({ ...baseline, phase: 'applied', moveId: started.id });
            }
            const agent = await context.openLocalAgent();
            const session = await agent.getSession(id);
            if (session === undefined) throw new Error('The local session no longer exists.');
            const known = new Set((await agent.getSessionHistory(id)).map((message) => message.id));
            const transcript = await resumeTranscript(exported.transcript_from_index, {
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
            const sentCount = toSyncedMessages(await agent.getSessionHistory(id)).length;
            await chat.save({
                ...baseline,
                phase: 'resumed',
                moveId: started.id,
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
                `◇ Local · ${id}\n  Resume: dexto -r ${id}\n  Previous local changes: git stash list (dexto hand-off backup)`
            );
        } catch (error) {
            if (!applied) {
                await cancelMove(transport, cloudId, started.id);
                await chat.save({ ...baseline, phase: 'cloud' });
            }
            throw error;
        }
    },
};

async function watchChat(context: CommandContext, cloudId: string): Promise<void> {
    let previous = '';
    try {
        while (!context.runtime.signal.aborted) {
            const value = await queryWorkspaceTool(context, 'dexto_chat_get', {
                sessionId: cloudId,
                limit: 50,
                roles: ['user', 'assistant'],
            });
            const serialized = JSON.stringify(value);
            if (serialized !== previous) {
                context.output.record(value);
                previous = serialized;
            }
            await context.runtime.sleep(2_000);
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
