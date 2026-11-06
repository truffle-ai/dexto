import { createHash } from 'node:crypto';
import { CloudApiError, unwrap, type CloudClient, type V1Response } from '@dexto/cloud-client';
import type { WorkingTree } from './working-tree.js';

export type ChatMove = V1Response<'/v1/synced_chats/{chat_id}/moves', 'post'>;
export interface MoveTransport {
    readonly client: CloudClient;
    readonly fetch: typeof globalThis.fetch;
    readonly signal: AbortSignal;
    readonly sleep: (ms: number) => Promise<void>;
}

export class CloudMoveFailure extends Error {
    constructor(
        error: unknown,
        readonly ownership: 'local' | 'unknown'
    ) {
        super(error instanceof Error ? error.message : 'Cloud hand-off failed.', { cause: error });
        this.name = 'CloudMoveFailure';
    }
}

export function describeObject(bytes: Uint8Array): { sha256: string; size_bytes: number } {
    return {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size_bytes: bytes.byteLength,
    };
}

/** Enforce the declared bound while reading, before allocating the complete download. */
export async function downloadMoveObject(
    transport: MoveTransport,
    object: { url: string; sha256: string; size_bytes: number }
): Promise<Buffer> {
    const response = await transport.fetch(object.url, {
        signal: transport.signal,
        redirect: 'error',
    });
    if (!response.ok || response.body === null)
        throw new Error(`Cloud export download failed (${response.status}).`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > object.size_bytes)
                throw new Error('Cloud export exceeds its declared size.');
            chunks.push(chunk.value);
        }
    } finally {
        await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    if (size !== object.size_bytes || describeObject(bytes).sha256 !== object.sha256)
        throw new Error('Cloud export checksum or size mismatch.');
    return bytes;
}

export async function waitForMove(
    transport: MoveTransport,
    chatId: string,
    started: ChatMove
): Promise<ChatMove> {
    let move = started;
    while (move.status === 'importing' || move.status === 'exporting') {
        if (Date.now() >= Date.parse(move.expires_at)) throw new Error('The chat move expired.');
        transport.signal.throwIfAborted();
        await transport.sleep(2_000);
        move = await unwrap(
            await transport.client.GET('/v1/synced_chats/{chat_id}/moves/{move_id}', {
                params: { path: { chat_id: chatId, move_id: move.id } },
                signal: transport.signal,
            })
        );
    }
    if (move.status === 'failed' || move.status === 'canceled' || move.status === 'expired')
        throw new Error(`Chat move ${move.status}: ${move.failure ?? move.status}.`);
    return move;
}

export async function cancelMove(
    transport: MoveTransport,
    chatId: string,
    moveId: string
): Promise<ChatMove> {
    // Cleanup must still run when the caller's signal is aborted.
    return await unwrap(
        await transport.client.POST('/v1/synced_chats/{chat_id}/moves/{move_id}/cancel', {
            params: { path: { chat_id: chatId, move_id: moveId } },
        })
    );
}

/** Recover the server's open return when its original start response never reached the CLI. */
export async function startLocalReturn(
    transport: MoveTransport,
    chatId: string
): Promise<ChatMove> {
    try {
        return await unwrap(
            await transport.client.POST('/v1/synced_chats/{chat_id}/moves', {
                params: { path: { chat_id: chatId } },
                body: { to: 'local' },
                signal: transport.signal,
            })
        );
    } catch (error) {
        if (
            !(error instanceof CloudApiError) ||
            error.code !== 'move_in_progress' ||
            typeof error.details !== 'object' ||
            error.details === null ||
            !('move_id' in error.details) ||
            typeof error.details.move_id !== 'string'
        )
            throw error;
        const move = await unwrap(
            await transport.client.GET('/v1/synced_chats/{chat_id}/moves/{move_id}', {
                params: { path: { chat_id: chatId, move_id: error.details.move_id } },
                signal: transport.signal,
            })
        );
        if (move.to !== 'local')
            throw new Error('The move to cloud is still open. Finish it with --to cloud first.');
        return move;
    }
}

export async function moveToCloud(
    transport: MoveTransport,
    chatId: string,
    tree: WorkingTree
): Promise<void> {
    let started: ChatMove;
    try {
        started = await unwrap(
            await transport.client.POST('/v1/synced_chats/{chat_id}/moves', {
                params: { path: { chat_id: chatId } },
                signal: transport.signal,
                body: {
                    to: 'cloud',
                    working_tree: {
                        branch: tree.branch,
                        head_commit: tree.head_commit,
                        bundle: describeObject(tree.bundle),
                        patch: tree.patch === null ? null : describeObject(tree.patch),
                    },
                },
            })
        );
    } catch (error) {
        if (error instanceof CloudApiError && error.code === 'chat_in_cloud') return;
        throw error;
    }
    try {
        for (const upload of started.uploads) {
            const bytes = upload.object === 'bundle' ? tree.bundle : tree.patch;
            if (bytes === null) throw new Error('The server requested an undeclared patch.');
            const response = await transport.fetch(upload.url, {
                method: 'PUT',
                headers: upload.headers,
                body: new Uint8Array(bytes),
                signal: transport.signal,
                redirect: 'error',
            });
            if (!response.ok) throw new Error(`Working-tree upload failed (${response.status}).`);
        }
        const importing = await unwrap(
            await transport.client.POST('/v1/synced_chats/{chat_id}/moves/{move_id}/uploaded', {
                params: { path: { chat_id: chatId, move_id: started.id } },
                signal: transport.signal,
            })
        );
        await waitForMove(transport, chatId, importing);
    } catch (error) {
        const canceled = await cancelMove(transport, chatId, started.id).catch(() => null);
        if (canceled?.status === 'completed') return;
        const local =
            canceled !== null &&
            (canceled.status === 'canceled' ||
                canceled.status === 'failed' ||
                canceled.status === 'expired');
        throw new CloudMoveFailure(error, local ? 'local' : 'unknown');
    }
}
