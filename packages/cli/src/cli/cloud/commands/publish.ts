// `publish`: puts a page, a document or a folder online as a Site.

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';
import { CloudApiError, unwrap, type V1Response } from '@dexto/cloud-client';

import {
    argument,
    stringOption,
    flag,
    signInCommand,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import { sendBytes } from '../transfer.js';
import { zipArchive, type ZipFile } from '../zip.js';
import { requireLoginScopes } from './deploys.js';
import { formatBytes } from './files.js';
import { queryWorkspaceTool } from './workspace.js';

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
const PublishedSchema = z
    .object({
        created: z.boolean(),
        files: z.number().int().nonnegative(),
        homepage: z.string(),
        site: z.object({ id: z.string(), slug: z.string(), title: z.string() }).strict(),
        url: z.string(),
        visibility: z.enum(['private', 'unlisted', 'public']),
    })
    .strict() satisfies z.ZodType<V1Response<'/v1/sites/publish', 'post'>>;

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
        visibility: {
            description: 'Who can open the Site: private, unlisted, or public.',
            type: 'string',
            valueName: 'VISIBILITY',
        },
        'confirm-public': {
            description: 'Confirm the exact existing private Site name before making it public.',
            type: 'string',
            valueName: 'SITE_NAME',
        },
        ...YES_OPTION,
    },
    path: ['publish'],
    summary: 'Publish a file, folder or .zip as a Site; publishing the same name again updates it.',
    async run(context, input) {
        const parsedVisibility = z
            .enum(['private', 'unlisted', 'public'])
            .optional()
            .safeParse(stringOption(input, 'visibility'));
        if (!parsedVisibility.success)
            throw new UsageError('--visibility must be private, unlisted, or public.');
        const visibility = parsedVisibility.data;
        const confirmPublicName = stringOption(input, 'confirm-public');
        if (confirmPublicName !== undefined && visibility !== 'public')
            throw new UsageError('--confirm-public requires --visibility public.');
        await requireLoginScopes(context, ['sites:write', 'cloud:write']);
        const connection = await context.connection();
        if (connection.kind !== 'oauth')
            throw new CommandFailure(
                'needs_sign_in',
                'Publishing files requires a workspace sign-in.',
                signInCommand(context, null)
            );
        if (connection.cloudProject === null)
            throw new CommandFailure(
                'invalid_input',
                'Choose a Cloud project with --project or dexto cloud projects use before publishing.',
                null
            );
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
        if (isZip) archive = new Uint8Array(await readFile(target));
        else {
            const files = found.isDirectory()
                ? await readFolder(target)
                : [{ bytes: await readFile(target), path: path.basename(target) }];
            checkSizes(files);
            archive = zipArchive(files);
        }
        if (archive.byteLength > MAX_UPLOAD_BYTES)
            throw new UsageError(
                `The .zip is ${formatBytes(archive.byteLength)}, over the ${formatBytes(MAX_UPLOAD_BYTES)} a published link's .zip can be.`
            );

        const call = {
            name,
            ...(slug === undefined ? {} : { slug }),
            ...(title === undefined ? {} : { title }),
            ...(visibility === undefined ? {} : { visibility }),
            ...(confirmPublicName === undefined ? {} : { confirmPublicName }),
        };
        await requireConsent(
            context,
            flag(input, 'yes'),
            visibility === undefined
                ? `Publish ${name} (a new Site is unlisted: anyone with the link can open it; an existing Site keeps its visibility).`
                : `Publish ${name} with ${visibility} visibility.`
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
        let response: unknown;
        try {
            response = await unwrap(
                await (
                    await context.client()
                ).POST('/v1/sites/publish', {
                    body: { ...call, uploadPath: prepared.data.path },
                })
            );
        } catch (error) {
            if (error instanceof CloudApiError && error.code === 'needs_confirmation')
                throw new CommandFailure(
                    'needs_confirmation',
                    `${error.message} Pass --confirm-public <site-name> with that exact name.`,
                    null
                );
            throw error;
        }
        const parsed = PublishedSchema.safeParse(response);
        if (!parsed.success)
            throw new CommandFailure(
                'failed',
                'Dexto returned an invalid Site publish result. Check the Site in Dexto before sharing it.',
                null
            );
        const published = parsed.data;
        if (visibility !== undefined && published.visibility !== visibility)
            throw new CommandFailure(
                'failed',
                `The Site was published with ${published.visibility} visibility, not the requested ${visibility}. Check its visibility in Dexto before sharing it.`,
                null
            );
        context.output.result(
            published,
            `${published.created ? 'Published' : 'Updated'} ${name} at ${published.url} (${published.files} file${published.files === 1 ? '' : 's'}).${published.visibility === 'private' ? ' Open it from Dexto as an organization member.' : ' Anyone with the link can open it.'}`
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
