// `publish`: puts a page, a document or a folder online as a link anyone with it can open.

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
    argument,
    CommandFailure,
    stringOption,
    flag,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import { sendBytes } from '../transfer.js';
import { zipArchive, type ZipFile } from '../zip.js';
import { requireLoginScopes } from './deploys.js';
import { formatBytes } from './files.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

/** What a published link takes, as Dexto's Sites do: files, each file's size and their total. */
const MAX_FILES = 100;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
/** The most the .zip that carries them can be, with room for its own headers. */
const MAX_UPLOAD_BYTES = MAX_TOTAL_BYTES + 1024 * 1024;

const PreparedSchema = z.object({
    headers: z.record(z.string(), z.string()),
    method: z.string(),
    path: z.string(),
    url: z.string(),
});
const PublishedSchema = z.object({
    created: z.boolean(),
    files: z.number(),
    url: z.string(),
});

const publish: Command = {
    arguments: '<path>',
    options: {
        name: {
            description:
                "What it's called: the page's title and, with your handle, its address (default: the file or folder's name). Publishing the same name again updates the same link.",
            type: 'string',
        },
        slug: {
            description:
                'Publish at <slug>.dexto.dev instead of an address made from the name; a Site of yours there is updated.',
            type: 'string',
        },
        title: { description: "The page's title (default: the name).", type: 'string' },
        ...YES_OPTION,
    },
    path: ['publish'],
    summary:
        'Publish a file, a folder or a .zip of one as a link anyone with it can open; publishing the same name again updates it.',
    async run(context, input) {
        await requireLoginScopes(context, ['sites:write']);
        const target = path.resolve(argument(input, 0, 'path'));
        const found = await stat(target).catch(() => null);
        if (found === null || !(found.isFile() || found.isDirectory()))
            throw new UsageError(`${target} isn't a file or folder.`);
        const isZip = found.isFile() && /\.zip$/iu.test(target);
        const name =
            stringOption(input, 'name') ??
            (found.isDirectory()
                ? path.basename(target)
                : path.basename(target, path.extname(target)));
        const slug = stringOption(input, 'slug');
        const title = stringOption(input, 'title');

        let archive: Uint8Array<ArrayBuffer>;
        let count: number | null = null;
        if (isZip) archive = new Uint8Array(await readFile(target));
        else {
            const files = found.isDirectory()
                ? await readFolder(target)
                : [{ bytes: await readFile(target), path: path.basename(target) }];
            checkSizes(files);
            archive = zipArchive(files);
            count = files.length;
        }
        if (archive.byteLength > MAX_UPLOAD_BYTES)
            throw new UsageError(
                `The .zip is ${formatBytes(archive.byteLength)}, over the ${formatBytes(MAX_UPLOAD_BYTES)} a published link's .zip can be.`
            );

        const tool = (await listWorkspaceTools(context)).find(
            (each) => each.name === 'dexto_site_publish'
        );
        if (tool === undefined)
            throw new CommandFailure('failed', "This Dexto can't publish files yet.", null);
        const call = {
            name,
            ...(slug === undefined ? {} : { slug }),
            ...(title === undefined ? {} : { title }),
        };
        const agreed = await agreeToCall(
            context,
            {
                level: toolCallLevel(tool, call),
                schema: tool.inputSchema,
                title: `Publish ${name} as a link anyone with it can open`,
            },
            flag(input, 'yes')
        );

        const prepared = PreparedSchema.safeParse(
            await queryWorkspaceTool(context, 'dexto_upload_prepare', {
                filename: `${path.basename(target, '.zip')}.zip`,
                mimeType: 'application/zip',
                purpose: 'site-files',
                sha256: createHash('sha256').update(archive).digest('hex'),
                sizeBytes: archive.byteLength,
            })
        );
        if (!prepared.success)
            throw new CommandFailure('failed', "Dexto didn't say where to upload the files.", null);
        const { headers, method, url } = prepared.data;
        await sendBytes(context, { headers, method, url }, new globalThis.Blob([archive]));
        const published = await queryWorkspaceTool(context, 'dexto_site_publish', {
            ...call,
            uploadPath: prepared.data.path,
            ...agreed,
        });
        const shown = PublishedSchema.safeParse(published);
        const files = shown.success ? shown.data.files : count;
        context.output.result(
            published,
            shown.success
                ? `${shown.data.created ? 'Published' : 'Updated'} ${name} at ${shown.data.url} (${files} file${files === 1 ? '' : 's'}). Anyone with the link can open it.`
                : JSON.stringify(published, null, 2)
        );
    },
};

/** The folder's files, by path, leaving out names that start with a dot and links. */
async function readFolder(folder: string): Promise<ZipFile[]> {
    const found: string[] = [];
    const visit = async (relative: string) => {
        const entries = await readdir(path.join(folder, relative), { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            if (entry.name.startsWith('.')) continue;
            const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
            if (entry.isDirectory()) await visit(child);
            else if (entry.isFile()) found.push(child);
            if (found.length > MAX_FILES)
                throw new UsageError(
                    `${folder} has more than ${MAX_FILES} files; a published link takes up to ${MAX_FILES}.`
                );
        }
    };
    await visit('');
    if (found.length === 0) throw new UsageError(`${folder} has no files to publish.`);
    return await Promise.all(
        found.map(async (file) => ({ bytes: await readFile(path.join(folder, file)), path: file }))
    );
}

function checkSizes(files: readonly ZipFile[]): void {
    const large = files.find((file) => file.bytes.byteLength > MAX_FILE_BYTES);
    if (large !== undefined)
        throw new UsageError(
            `${large.path} is ${formatBytes(large.bytes.byteLength)}; a published file can be up to ${formatBytes(MAX_FILE_BYTES)}.`
        );
    const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    if (total > MAX_TOTAL_BYTES)
        throw new UsageError(
            `The files come to ${formatBytes(total)}; a published link takes up to ${formatBytes(MAX_TOTAL_BYTES)}.`
        );
}

export const publishCommands: readonly Command[] = [publish];
