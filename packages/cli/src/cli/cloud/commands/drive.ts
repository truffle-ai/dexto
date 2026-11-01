// `drive put`: uploads local files and folder trees to Drive, versioning same-named files.

import { randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
    CommandFailure,
    isJsonObject,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
} from '../command.js';
import { sendBytes, type TransferTarget } from '../transfer.js';
import { contentTypeFor, formatBytes, hashFile } from './files.js';
import { queryWorkspaceTool } from './workspace.js';

/** How many files upload at once. */
const CONCURRENCY = 4;

/** How many times a part, or the completion, is sent before a network failure gives it up. */
const PART_ATTEMPTS = 3;

/** How long giving an upload up may take, even after the command was cancelled. */
const ABORT_TIMEOUT_MS = 10_000;

/** A local file, and the local folder it goes into (null for the `--to` folder). */
interface LocalFile {
    readonly folder: string | null;
    readonly localPath: string;
    readonly size: number;
}

/** A local folder to make in Drive, under its parent's local path (null for the `--to` folder). */
interface LocalFolder {
    readonly localPath: string;
    readonly parent: string | null;
}

/** A Drive item as a list describes it. */
const ItemSchema = z
    .object({
        id: z.string(),
        kind: z.string(),
        name: z.string(),
        parentId: z.string().nullable(),
        revision: z.number(),
        sha256: z.string().nullable().default(null),
        size: z.number().nullable().default(null),
        trashedAt: z.string().nullable().default(null),
    })
    .passthrough();
type DriveItem = z.output<typeof ItemSchema>;

/** The items of each Drive folder listed so far, by folder id ("" for the top of Drive). */
type Listed = Map<string, Promise<DriveItem[]>>;

const UsageSchema = z.object({ limits: z.object({ fileBytes: z.number() }) });
const PageSchema = z.object({ items: z.array(ItemSchema), nextOffset: z.number().nullable() });
const FolderSchema = z.object({ item: z.object({ id: z.string() }).passthrough() });
const Endpoint = z.object({ method: z.string(), url: z.string() });
/** Where a reserved upload goes: one URL, or, for a large file, its parts and their completion. */
const ReservedSchema = z.object({
    upload: z.union([
        z.object({
            multipart: z.object({
                abort: Endpoint,
                complete: Endpoint,
                partCount: z.number().int().positive(),
                partSize: z.number().int().positive(),
                parts: Endpoint,
            }),
        }),
        Endpoint,
    ]),
});
type MultipartPlan = Extract<
    z.output<typeof ReservedSchema>['upload'],
    { multipart: unknown }
>['multipart'];

const put: Command = {
    arguments: '<paths...>',
    options: {
        to: {
            description: 'The Drive folder to put them in, by id (default: the top of your Drive).',
            type: 'string',
            valueName: 'FOLDER_ID',
        },
    },
    path: ['workspace', 'drive', 'put'],
    summary:
        'Upload local files and folders (dotfiles left out) to your Drive; a file already there by name gets a new version, unless its bytes are the same.',
    async run(context, input) {
        const to = stringOption(input, 'to') ?? null;
        const { files, folders } = await collect(input.positionals);
        const usage = UsageSchema.parse(
            await queryWorkspaceTool(context, 'dexto_drive', { action: 'usage' })
        );
        const limit = usage.limits.fileBytes;
        const tooLarge = files.filter((file) => file.size > limit);
        if (tooLarge.length > 0)
            throw new CommandFailure(
                'invalid_input',
                `Drive takes files up to ${formatBytes(limit)}, and ${tooLarge
                    .map((file) => `${file.localPath} is ${formatBytes(file.size)}`)
                    .join(
                        ', '
                    )}. Leave ${tooLarge.length === 1 ? 'it' : 'them'} out and run it again.`,
                null
            );

        // Listing the destination first fails the run at once when it isn't a folder you can use.
        const listed: Listed = new Map();
        await listFolder(context, listed, to);
        // Parents come before their children, so each folder's parent is there by the time it is.
        const folderIds = new Map<string, string>();
        const putFolders: {
            item: Record<string, unknown>;
            path: string;
            status: 'created' | 'existing';
        }[] = [];
        for (const folder of folders) {
            const parentId = folder.parent === null ? to : (folderIds.get(folder.parent) ?? null);
            const name = path.basename(path.resolve(folder.localPath));
            const existing = await findItem(context, listed, parentId, 'folder', name);
            const item =
                existing ??
                FolderSchema.parse(
                    await queryWorkspaceTool(context, 'dexto_drive', {
                        action: 'folder',
                        name,
                        parentId,
                        requestId: randomUUID(),
                    })
                ).item;
            // A folder made just now has nothing in it to list.
            if (existing === null) listed.set(item.id, Promise.resolve([]));
            folderIds.set(folder.localPath, item.id);
            putFolders.push({
                item,
                path: folder.localPath,
                status: existing === null ? 'created' : 'existing',
            });
        }

        const saved: {
            item: Record<string, unknown>;
            path: string;
            status: 'created' | 'updated' | 'unchanged';
        }[] = [];
        const failed: { error: string; path: string }[] = [];
        // Files bound for one name in one folder go one after another, each a version of the last.
        const bound = new Map<string, LocalFile[]>();
        for (const file of files) {
            const parentId = file.folder === null ? to : (folderIds.get(file.folder) ?? null);
            const key = `${parentId ?? ''}/${path.basename(file.localPath)}`;
            bound.set(key, [...(bound.get(key) ?? []), file]);
        }
        await eachAtOnce([...bound.values()], async (sameName) => {
            for (const file of sameName) {
                const parentId = file.folder === null ? to : (folderIds.get(file.folder) ?? null);
                try {
                    const existing = await findItem(
                        context,
                        listed,
                        parentId,
                        'file',
                        path.basename(file.localPath)
                    );
                    const sha256 = await hashFile(file.localPath);
                    // Drive already has these bytes under this name: nothing to send.
                    if (existing?.sha256 === sha256 && existing.size === file.size) {
                        saved.push({ item: existing, path: file.localPath, status: 'unchanged' });
                        if (!context.output.json)
                            context.runtime.writeOutput(
                                `Unchanged ${file.localPath} (${formatBytes(file.size)}, ${existing.id})\n`
                            );
                        continue;
                    }
                    const item = await putFile(context, file, parentId, existing, sha256, null);
                    await remember(listed, parentId, item);
                    const status = existing === null ? 'created' : 'updated';
                    saved.push({ item, path: file.localPath, status });
                    if (!context.output.json)
                        context.runtime.writeOutput(
                            `${status === 'created' ? 'Created' : 'Updated'} ${file.localPath} (${formatBytes(file.size)}, ${String(item.id)})\n`
                        );
                } catch (error) {
                    // A sign-in that can't write fails every file the same way: stop, say so once.
                    if (
                        error instanceof CommandFailure &&
                        (error.kind === 'needs_sign_in' || error.kind === 'needs_permission')
                    )
                        throw error;
                    const message = error instanceof Error ? error.message : String(error);
                    failed.push({ error: message, path: file.localPath });
                    context.runtime.writeError(`Couldn't upload ${file.localPath}: ${message}\n`);
                }
            }
        });

        const created = saved.filter((each) => each.status === 'created').length;
        const updated = saved.filter((each) => each.status === 'updated').length;
        const unchanged = saved.length - created - updated;
        const madeFolders = putFolders.filter((each) => each.status === 'created').length;
        context.output.result(
            {
                created,
                failed,
                files: saved,
                folders: putFolders,
                unchanged,
                updated,
            },
            `Uploaded ${created + updated} of ${files.length} file${files.length === 1 ? '' : 's'}: ${created} created, ${updated} updated with a new version${unchanged === 0 ? '' : `, ${unchanged} already up to date`}.${
                putFolders.length === 0
                    ? ''
                    : ` Folders: ${madeFolders} created, ${putFolders.length - madeFolders} already there.`
            }`
        );
        if (failed.length > 0)
            throw new CommandFailure(
                'failed',
                `${failed.length} file${failed.length === 1 ? '' : 's'} didn't upload: ${failed.map((each) => each.path).join(', ')}.`,
                null
            );
    },
};

/**
 * The files and folders the paths name. A folder brings what's in it, except names starting with a
 * dot and links, which are left out; a path named on its own is taken as it is.
 */
async function collect(
    paths: readonly string[]
): Promise<{ files: LocalFile[]; folders: LocalFolder[] }> {
    const files: LocalFile[] = [];
    const folders: LocalFolder[] = [];
    const visit = async (localPath: string, parent: string | null, named: boolean) => {
        const stats = await (named ? stat(localPath) : lstat(localPath)).catch(() => null);
        if (stats?.isFile() === true) {
            files.push({ folder: parent, localPath, size: stats.size });
            return;
        }
        if (stats?.isDirectory() !== true) {
            if (named) throw new UsageError(`${localPath} is not a file or folder.`);
            return;
        }
        folders.push({ localPath, parent });
        const names = (await readdir(localPath)).filter((name) => !name.startsWith('.')).sort();
        for (const name of names) await visit(path.join(localPath, name), localPath, false);
    };
    for (const localPath of paths) await visit(localPath, null, true);
    return { files, folders };
}

/** The item of this kind and name in a Drive folder (null for the top), listing it once a run. */
async function findItem(
    context: CommandContext,
    listed: Listed,
    parentId: string | null,
    kind: 'file' | 'folder',
    name: string
): Promise<DriveItem | null> {
    const items = await listFolder(context, listed, parentId);
    return items.find((item) => item.kind === kind && item.name === name) ?? null;
}

/** Puts what an upload saved in its folder's listing, so the next file of that name versions it. */
async function remember(
    listed: Listed,
    parentId: string | null,
    saved: Record<string, unknown>
): Promise<void> {
    const item = ItemSchema.safeParse(saved);
    if (!item.success) return;
    const key = parentId ?? '';
    const items = (await listed.get(key)) ?? [];
    listed.set(
        key,
        Promise.resolve([...items.filter((each) => each.id !== item.data.id), item.data])
    );
}

/** Every item in a Drive folder, page by page, trash left out; each folder is listed once. */
function listFolder(
    context: CommandContext,
    listed: Listed,
    parentId: string | null
): Promise<DriveItem[]> {
    const known = listed.get(parentId ?? '');
    if (known !== undefined) return known;
    const listing = (async () => {
        const items: DriveItem[] = [];
        for (let offset: number | null = 0; offset !== null; ) {
            const page = PageSchema.parse(
                await queryWorkspaceTool(context, 'dexto_drive', {
                    action: 'list',
                    offset,
                    parentId,
                })
            );
            items.push(...page.items.filter((item) => item.trashedAt === null));
            offset = page.nextOffset;
        }
        return items;
    })();
    listed.set(parentId ?? '', listing);
    return listing;
}

/**
 * Reserves one file in Drive under a new request id, as a new version of `existing` when there is
 * one, then sends its bytes to the URL Drive returns. A file too large for one request would be
 * sent in parts here, once Drive takes them.
 */
async function putFile(
    context: CommandContext,
    file: LocalFile,
    parentId: string | null,
    existing: DriveItem | null,
    sha256: string,
    /** The app whose own folder the file goes into instead, which gives the app the file. */
    appId: string | null
): Promise<Record<string, unknown>> {
    const mimeType = contentTypeFor(file.localPath);
    const reserved = ReservedSchema.safeParse(
        await queryWorkspaceTool(context, 'dexto_drive', {
            action: 'upload',
            ...(appId === null ? {} : { appId }),
            mimeType,
            name: path.basename(file.localPath),
            requestId: randomUUID(),
            sha256,
            size: file.size,
            ...(existing === null
                ? { parentId }
                : {
                      expectedRevision: existing.revision,
                      parentId: existing.parentId,
                      targetId: existing.id,
                  }),
        })
    );
    if (!reserved.success)
        throw new CommandFailure('failed', "Drive didn't say where to send the file.", null);
    const { upload } = reserved.data;
    const bytes = await openAsBlob(file.localPath);
    const reply =
        'multipart' in upload
            ? await sendParts(context, upload.multipart, bytes)
            : await sendBytes(
                  context,
                  { headers: { 'content-type': mimeType }, method: upload.method, url: upload.url },
                  bytes
              );
    return isJsonObject(reply) && isJsonObject(reply.item) ? reply.item : {};
}

/**
 * Uploads one local file into an app's own Drive folder, which gives the app the file to refer to
 * as `drive:<id>`.
 */
export async function putAppFile(
    context: CommandContext,
    localPath: string,
    appId: string
): Promise<{ id: string; mimeType: string; name: string }> {
    const info = await stat(localPath).catch(() => null);
    if (info === null || !info.isFile())
        throw new UsageError(`Can't read ${localPath}: give a file's path, or a link.`);
    const item = await putFile(
        context,
        { folder: null, localPath, size: info.size },
        null,
        null,
        await hashFile(localPath),
        appId
    );
    if (typeof item.id !== 'string')
        throw new CommandFailure('failed', `Drive didn't return ${localPath}'s file.`, null);
    return { id: item.id, mimeType: contentTypeFor(localPath), name: path.basename(localPath) };
}

/**
 * Sends a large file in the exact parts Drive asked for, a few at once, then completes it. A part
 * or completion the network drops is sent again; one that still fails, or is refused, gives the
 * upload up at once, so it holds no quota until it expires, even when the command was cancelled.
 */
async function sendParts(context: CommandContext, plan: MultipartPlan, bytes: globalThis.Blob) {
    const numbers = Array.from({ length: plan.partCount }, (_, index) => index + 1);
    try {
        await eachAtOnce(numbers, async (number) => {
            await sendRetrying(
                context,
                { headers: {}, method: plan.parts.method, url: `${plan.parts.url}/${number}` },
                bytes.slice((number - 1) * plan.partSize, number * plan.partSize),
                1
            );
        });
        return await sendRetrying(
            context,
            { headers: {}, method: plan.complete.method, url: plan.complete.url },
            new globalThis.Blob([]),
            1
        );
    } catch (error) {
        // Its own signal: the command's is already aborted when Ctrl-C ended the upload.
        await context.runtime
            .fetch(plan.abort.url, {
                method: plan.abort.method,
                signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
            })
            .catch(() => undefined);
        throw error;
    }
}

/**
 * Sends a part or the completion, again after a second and then two when the network drops it.
 * Drive keeps the last copy of a part sent twice and completes an upload once; a refusal stands.
 */
async function sendRetrying(
    context: CommandContext,
    target: TransferTarget,
    body: globalThis.Blob,
    attempt: number
): Promise<unknown> {
    try {
        return await sendBytes(context, target, body);
    } catch (error) {
        // fetch rejects with a TypeError when the request never got a response.
        if (!(error instanceof TypeError) || attempt === PART_ATTEMPTS) throw error;
        await context.runtime.sleep(1000 * attempt);
        return await sendRetrying(context, target, body, attempt + 1);
    }
}

/** Runs `run` over the items, a few at once; the first error it throws stops the rest. */
async function eachAtOnce<T>(items: readonly T[], run: (item: T) => Promise<void>) {
    let next = 0;
    const worker = async () => {
        for (let item = items[next++]; item !== undefined; item = items[next++]) {
            try {
                await run(item);
            } catch (error) {
                next = items.length;
                throw error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

export const driveCommands: readonly Command[] = [put];
