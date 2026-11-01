// `cloud files`: upload, download, share and delete the project's files.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { unwrap, type CloudClient, type V1Response } from '@dexto/cloud-client';
import {
    argument,
    CommandFailure,
    flag,
    integerOption,
    PAGE_OPTIONS,
    pageQuery,
    requireConsent,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import type { Column } from '../output.js';
import { sendV1, v1Failure } from '../v1.js';

type CloudFile = V1Response<'/v1/files/{file_id}', 'get'>;

/** Larger files go up in parts, through an upload session. */
const ONE_REQUEST_MAX_BYTES = 80 * 1024 * 1024;

const COLUMNS: readonly Column<CloudFile>[] = [
    { header: 'id', value: (file) => file.id },
    { header: 'path', value: (file) => file.path },
    { header: 'size', value: (file) => formatBytes(file.size_bytes) },
    { header: 'type', value: (file) => file.content_type },
    { header: 'updated', value: (file) => file.updated_at },
];

const list: Command = {
    options: {
        ...PAGE_OPTIONS,
        contains: { description: 'Only paths containing this text.', type: 'string' },
        prefix: { description: 'Only paths starting with this, such as reports/.', type: 'string' },
    },
    path: ['cloud', 'files', 'list'],
    summary: "List the project's files.",
    async run(context, input) {
        const prefix = stringOption(input, 'prefix');
        const contains = stringOption(input, 'contains');
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/files', {
                params: {
                    query: {
                        ...pageQuery(input),
                        ...(prefix === undefined ? {} : { prefix }),
                        ...(contains === undefined ? {} : { contains }),
                    },
                },
            })
        );
        context.output.list(page, COLUMNS);
    },
};

const get: Command = {
    arguments: '<file>',
    path: ['cloud', 'files', 'get'],
    summary: 'Show a file by id or path.',
    async run(context, input) {
        const client = await context.client();
        context.output.record(
            await getFile(client, await resolveFileId(client, argument(input, 0, 'file')))
        );
    },
};

const upload: Command = {
    arguments: '<local_path> [path]',
    options: {
        'content-type': {
            description: 'The media type (default from the extension).',
            type: 'string',
        },
        'expires-at': {
            description: 'Delete the file at this ISO 8601 time.',
            type: 'string',
            valueName: 'TIME',
        },
        overwrite: { description: 'Replace a file already at the path.', type: 'boolean' },
    },
    path: ['cloud', 'files', 'upload'],
    summary: 'Upload a local file to a project path (default: its file name).',
    async run(context, input) {
        const localPath = argument(input, 0, 'local_path');
        if (!(await stat(localPath).catch(() => null))?.isFile())
            throw new UsageError(`${localPath} is not a file.`);
        const body = await openAsBlob(localPath).catch((error: unknown) => {
            throw new UsageError(
                `Cannot read ${localPath}: ${error instanceof Error ? error.message : 'unknown error'}.`
            );
        });
        const expiresAt = stringOption(input, 'expires-at');
        const file = await uploadFile(context, {
            body,
            contentType: stringOption(input, 'content-type') ?? contentTypeFor(localPath),
            expiresAt: expiresAt ?? null,
            overwrite: flag(input, 'overwrite'),
            path: input.positionals[1] ?? path.basename(localPath),
            sha256: await hashFile(localPath),
        });
        context.output.result(
            file,
            `Uploaded ${file.path} (${formatBytes(file.size_bytes)}, ${file.id}).`
        );
    },
};

const download: Command = {
    arguments: '<file> [local_path]',
    path: ['cloud', 'files', 'download'],
    summary:
        'Download a file by id or path to a local path (default: its file name), or - for stdout.',
    async run(context, input) {
        const client = await context.client();
        const fileId = await resolveFileId(client, argument(input, 0, 'file'));
        const file = await getFile(client, fileId);
        const target = input.positionals[1] ?? path.basename(file.path);
        const { data, response } = await client.GET('/v1/files/{file_id}/content', {
            params: { path: { file_id: fileId } },
            parseAs: 'stream',
        });
        if (!response.ok || data === undefined || data === null)
            throw v1Failure(context, response.status, await response.text().catch(() => ''));
        if (target === '-') {
            const reader = data.getReader();
            for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
                await context.runtime.writeBytes(chunk.value);
            return;
        }
        await data.pipeTo(Writable.toWeb(createWriteStream(target)));
        context.output.result({ ...file, local_path: target }, `Saved ${file.path} to ${target}.`);
    },
};

const url: Command = {
    arguments: '<file>',
    options: {
        'expires-in': {
            description: 'Seconds the URL works, up to 86400 (default 3600).',
            type: 'string',
            valueName: 'SECONDS',
        },
    },
    path: ['cloud', 'files', 'url'],
    summary: 'Create a URL anyone can read the file from until it expires.',
    async run(context, input) {
        const client = await context.client();
        const expiresIn = integerOption(input, 'expires-in');
        const result = await unwrap(
            await client.POST('/v1/files/{file_id}/url', {
                params: {
                    path: { file_id: await resolveFileId(client, argument(input, 0, 'file')) },
                },
                body: expiresIn === undefined ? {} : { expires_in: expiresIn },
            })
        );
        context.output.result(result, result.url);
    },
};

const remove: Command = {
    arguments: '<file>',
    options: YES_OPTION,
    path: ['cloud', 'files', 'delete'],
    summary: 'Delete a file by id or path.',
    async run(context, input) {
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Deleting ${argument(input, 0, 'file')} can't be undone.`
        );
        const client = await context.client();
        const result = await unwrap(
            await client.DELETE('/v1/files/{file_id}', {
                params: {
                    path: { file_id: await resolveFileId(client, argument(input, 0, 'file')) },
                },
            })
        );
        context.output.result(result, `Deleted file ${result.id}.`);
    },
};

async function getFile(client: CloudClient, fileId: string): Promise<CloudFile> {
    return await unwrap(
        await client.GET('/v1/files/{file_id}', { params: { path: { file_id: fileId } } })
    );
}

export interface FileUpload {
    readonly body: globalThis.Blob;
    readonly contentType: string;
    readonly expiresAt: string | null;
    readonly overwrite: boolean;
    readonly path: string;
    readonly sha256: string;
}

/**
 * Uploads a file: in one request up to 80 MiB, otherwise in parts through an upload session,
 * aborted when a part fails.
 */
export async function uploadFile(context: CommandContext, upload: FileUpload): Promise<CloudFile> {
    if (upload.body.size <= ONE_REQUEST_MAX_BYTES) {
        const query = new URLSearchParams({ path: upload.path });
        if (upload.overwrite) query.set('overwrite', 'true');
        if (upload.expiresAt !== null) query.set('expires_at', upload.expiresAt);
        const response = await sendV1(context, 'POST', `/v1/files?${query}`, {
            body: upload.body,
            headers: {
                accept: 'application/json',
                'content-type': upload.contentType,
                'content-length': String(upload.body.size),
                'x-content-sha256': upload.sha256,
            },
        });
        const text = await response.text();
        if (!response.ok) throw v1Failure(context, response.status, text);
        return JSON.parse(text);
    }
    const client = await context.client();
    const session = await unwrap(
        await client.POST('/v1/files/uploads', {
            body: {
                content_type: upload.contentType,
                overwrite: upload.overwrite,
                path: upload.path,
                sha256: upload.sha256,
                size_bytes: upload.body.size,
                ...(upload.expiresAt === null ? {} : { expires_at: upload.expiresAt }),
            },
        })
    );
    const params = { params: { path: { upload_id: session.id } } };
    try {
        if (session.upload_url === null)
            throw new CommandFailure('failed', 'The upload session has no upload URL.', null);
        // `parts` lists the parts already uploaded; send every other one of `part_count`.
        const uploaded = new Set(session.parts.map((part) => part.part_number));
        for (let partNumber = 1; partNumber <= session.part_count; partNumber += 1) {
            if (uploaded.has(partNumber)) continue;
            const start = (partNumber - 1) * session.part_size_bytes;
            const response = await context.runtime.fetch(`${session.upload_url}/${partNumber}`, {
                body: upload.body.slice(
                    start,
                    Math.min(start + session.part_size_bytes, session.size_bytes)
                ),
                method: 'PUT',
                signal: context.runtime.signal,
            });
            if (!response.ok)
                throw new CommandFailure(
                    'failed',
                    `Part ${partNumber} of the upload was refused (HTTP ${response.status}).`,
                    null
                );
        }
        return await unwrap(await client.POST('/v1/files/uploads/{upload_id}/complete', params));
    } catch (error) {
        await client.POST('/v1/files/uploads/{upload_id}/abort', params).catch(() => undefined);
        throw error;
    }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * A file id as given, or the id of the file at a path. The API addresses files only by id, so a
 * path is found by listing its prefix.
 */
async function resolveFileId(client: CloudClient, file: string): Promise<string> {
    if (UUID.test(file)) return file;
    let after: string | undefined;
    for (;;) {
        const page = await unwrap(
            await client.GET('/v1/files', {
                params: {
                    query: { limit: 1000, prefix: file, ...(after === undefined ? {} : { after }) },
                },
            })
        );
        const match = page.data.find((each) => each.path === file);
        if (match !== undefined) return match.id;
        if (!page.has_more || page.next_after === null) break;
        after = page.next_after;
    }
    throw new CommandFailure('not_found', `No file at ${file}.`, null);
}

/** A local file's SHA-256, hex, read as a stream. */
export async function hashFile(localPath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(localPath)) hash.update(chunk);
    return hash.digest('hex');
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    '.csv': 'text/csv',
    '.gif': 'image/gif',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.m4v': 'video/mp4',
    '.md': 'text/markdown',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
};

/** The media type for a local file, by its extension. */
export function contentTypeFor(localPath: string): string {
    return CONTENT_TYPES[path.extname(localPath).toLowerCase()] ?? 'application/octet-stream';
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
}

export const fileCommands: readonly Command[] = [list, get, upload, download, url, remove];
