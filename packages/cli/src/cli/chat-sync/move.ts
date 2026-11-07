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

/** Only transport failures and temporary server refusals are safe to retry automatically. */
export function transientRetryDelay(error: unknown, attempt: number): number | null {
    if (error instanceof CloudApiError) {
        if (error.status !== 429 && error.status !== 408 && error.status < 500) return null;
        if (error.retryAfterSeconds !== null) return Math.max(250, error.retryAfterSeconds * 1_000);
    } else if (!(error instanceof TypeError)) return null;
    return Math.min(2_000 * 2 ** attempt, 30_000);
}

export async function waitForMove(
    transport: MoveTransport,
    chatId: string,
    started: ChatMove
): Promise<ChatMove> {
    let move = started;
    let delay = 2_000;
    let failures = 0;
    while (move.status === 'importing' || move.status === 'exporting') {
        transport.signal.throwIfAborted();
        await transport.sleep(delay);
        try {
            const response = await transport.client.GET(
                '/v1/synced_chats/{chat_id}/moves/{move_id}',
                {
                    params: { path: { chat_id: chatId, move_id: move.id } },
                    signal: transport.signal,
                }
            );
            // Local wall clocks may be wrong. The server owns the move's expiry.
            const serverNow = Date.parse(response.response.headers.get('date') ?? '');
            if (response.error !== undefined && serverNow >= Date.parse(move.expires_at))
                throw new Error('The chat move expired.');
            move = await unwrap(response);
            if (
                (move.status === 'importing' || move.status === 'exporting') &&
                serverNow >= Date.parse(move.expires_at)
            )
                throw new Error('The chat move expired.');
            failures = 0;
            delay = 2_000;
        } catch (error) {
            transport.signal.throwIfAborted();
            const retry = transientRetryDelay(error, failures);
            if (retry === null) throw error;
            failures += 1;
            delay = retry;
        }
    }
    if (move.status === 'failed' && move.failure === 'update_cli_for_lfs')
        throw new Error(
            'This chat contains Git LFS files. Update the Dexto CLI before returning it.'
        );
    if (move.status === 'failed' && move.failure === 'lfs_unavailable')
        throw new Error(
            'The cloud computer does not have Git LFS. Move the chat to a current computer and retry.'
        );
    if (
        move.status === 'failed' &&
        move.lfs_failure != null &&
        (move.failure === 'lfs_missing' || move.failure === 'lfs_too_large')
    ) {
        const { path, size_bytes } = move.lfs_failure;
        const action =
            move.failure === 'lfs_missing'
                ? 'Restore its LFS object on the source computer and retry.'
                : 'Reduce the handoff size and retry.';
        throw new Error(
            `Git LFS file ${JSON.stringify(path)} (${size_bytes} bytes) cannot move. ${action}`
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

async function readOpenMove(
    transport: MoveTransport,
    chatId: string,
    error: unknown
): Promise<ChatMove | null> {
    if (
        !(error instanceof CloudApiError) ||
        error.code !== 'move_in_progress' ||
        typeof error.details !== 'object' ||
        error.details === null ||
        !('move_id' in error.details) ||
        typeof error.details.move_id !== 'string'
    )
        return null;
    return await unwrap(
        await transport.client.GET('/v1/synced_chats/{chat_id}/moves/{move_id}', {
            params: { path: { chat_id: chatId, move_id: error.details.move_id } },
            signal: transport.signal,
        })
    );
}

/** Recover the server's open return when its original start response never reached the CLI. */
export async function startLocalReturn(
    transport: MoveTransport,
    chatId: string
): Promise<ChatMove> {
    const start = async () =>
        unwrap(
            await transport.client.POST('/v1/synced_chats/{chat_id}/moves', {
                params: { path: { chat_id: chatId } },
                body: { to: 'local', lfsObjects: 'v1' },
                signal: transport.signal,
            })
        );
    try {
        return await start();
    } catch (error) {
        const move = await readOpenMove(transport, chatId, error);
        if (move === null) throw error;
        if (move.to === 'local') return move;
        // Reconcile an interrupted outbound request in the direction the person asked for.
        // A canceled upload is local (chat_local); an import that completed can now return.
        await cancelMove(transport, chatId, move.id);
        return await start();
    }
}

export async function moveToCloud(
    transport: MoveTransport,
    chatId: string,
    tree: WorkingTree
): Promise<void> {
    const start = async () =>
        unwrap(
            await transport.client.POST('/v1/synced_chats/{chat_id}/moves', {
                params: { path: { chat_id: chatId } },
                signal: transport.signal,
                body: {
                    to: 'cloud',
                    lfsObjects: 'v1',
                    working_tree: {
                        branch: tree.branch,
                        head_commit: tree.head_commit,
                        bundle: describeObject(tree.bundle),
                        patch: tree.patch === null ? null : describeObject(tree.patch),
                    },
                },
            })
        );
    let started: ChatMove;
    try {
        started = await start();
    } catch (error) {
        if (error instanceof CloudApiError && error.code === 'chat_in_cloud') return;
        if (!(error instanceof CloudApiError) || error.code !== 'move_in_progress') throw error;
        try {
            const open = await readOpenMove(transport, chatId, error);
            if (open === null) throw error;
            if (open.to !== 'cloud')
                throw new Error('A return is already open. Finish it with --to local.');
            const canceled = await cancelMove(transport, chatId, open.id);
            if (canceled.status === 'completed') return;
            if (
                canceled.status !== 'canceled' &&
                canceled.status !== 'expired' &&
                canceled.status !== 'failed'
            )
                throw new CloudMoveFailure(error, 'unknown');
            started = await start();
        } catch (reconciliationError) {
            // A refused lookup/cancellation/restart cannot establish where the earlier move ran.
            throw new CloudMoveFailure(reconciliationError, 'unknown');
        }
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
