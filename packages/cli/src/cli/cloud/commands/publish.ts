// `publish`: puts a page, a document or a folder online as a Site.

import { CommandFailure } from '../../failure.js';
import { requireConsent, rerunWith } from '../../interaction.js';

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';
import { CloudApiError, createCloudClient, unwrap, type V1Response } from '@dexto/cloud-client';

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

const VisibilitySchema = z.enum(['private', 'restricted', 'unlisted', 'public']);
type Visibility = z.output<typeof VisibilitySchema>;
const PreviewSchema = z
    .object({
        action: z.enum(['create', 'update']),
        siteId: z.string().nullable(),
        slug: z.string(),
        title: z.string(),
        url: z.string(),
        visibility: VisibilitySchema,
    })
    .strict()
    .refine(
        (preview) => (preview.action === 'create') === (preview.siteId === null)
    ) satisfies z.ZodType<V1Response<'/v1/sites/publish/preview', 'post'>>;
/** Who can open a Site of each visibility, as the --yes note and the human result say it. */
const WHO_CAN_OPEN: Record<Visibility, { note: string; result: string }> = {
    private: {
        note: 'only you and your organization can open it',
        result: 'Open it from Dexto as an organization member.',
    },
    restricted: {
        note: 'only you, Owners, Admins and people you share it with can open it',
        result: 'Open it from Dexto; only you, Owners, Admins and people you share it with can.',
    },
    unlisted: {
        note: 'anyone with the link can open it',
        result: 'Anyone with the link can open it.',
    },
    public: {
        note: 'anyone with the link can open it',
        result: 'Anyone with the link can open it.',
    },
};

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
        visibility: VisibilitySchema,
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
            description:
                'Who can open the Site: private (your organization), restricted (people with access), unlisted, or public.',
            type: 'string',
            valueName: 'VISIBILITY',
        },
        'confirm-public': {
            description: 'Confirm the exact existing private Site name before making it public.',
            type: 'string',
            valueName: 'SITE_NAME',
        },
        'dry-run': {
            description: 'Show where the Site would publish without uploading or publishing.',
            type: 'boolean',
        },
        yes: {
            ...YES_OPTION.yes,
            description: 'Approve the preview from this invocation without asking again.',
        },
    },
    path: ['publish'],
    summary:
        'Publish a file, folder or .zip as a Site; publishing the same name again updates it. Requires sites:write and cloud:write. Example: dexto publish ./dist --yes',
    async run(context, input) {
        const parsedVisibility = VisibilitySchema.optional().safeParse(
            stringOption(input, 'visibility')
        );
        if (!parsedVisibility.success)
            throw new UsageError('--visibility must be private, restricted, unlisted, or public.');
        const visibility = parsedVisibility.data;
        const confirmPublicName = stringOption(input, 'confirm-public');
        if (confirmPublicName !== undefined && visibility !== 'public')
            throw new UsageError('--confirm-public requires --visibility public.');
        const connection = await context.connection();
        const publishContext = { ...context, connection: async () => connection };
        await requireLoginScopes(publishContext, ['sites:write', 'cloud:write']);
        if (connection.kind !== 'oauth')
            throw new CommandFailure(
                'needs_sign_in',
                'Publishing files requires a workspace sign-in.',
                signInCommand(context, [])
            );
        if (connection.cloudProject === null)
            throw new CommandFailure(
                'invalid_input',
                'Choose a Cloud project with --project or dexto cloud projects use before publishing.',
                null
            );
        const client = createCloudClient({
            apiBaseUrl: connection.apiBaseUrl,
            cloudProject: connection.cloudProject,
            token: connection.token,
            fetch: context.runtime.fetch,
        });
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
            if (!context.output.json)
                context.output.note(
                    `Packed ${files.length} file${files.length === 1 ? '' : 's'} into a ${formatBytes(archive.byteLength)} .zip.`
                );
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
        let previewResponse: unknown;
        try {
            previewResponse = await unwrap(
                await client.POST('/v1/sites/publish/preview', {
                    params: { header: { 'Dexto-Cloud-Project': connection.cloudProject } },
                    body: call,
                })
            );
        } catch (error) {
            if (error instanceof CloudApiError && error.code === 'needs_confirmation')
                throw new CommandFailure(
                    'needs_confirmation',
                    `${error.message} Pass --confirm-public <site-name> with that exact name.`,
                    rerunWith(context, '--confirm-public', '<site-name>'),
                    error.details
                );
            if (
                error instanceof CloudApiError &&
                error.code === 'conflict' &&
                visibility === 'public'
            )
                throw new CommandFailure(
                    'conflict',
                    `${error.message} If a Site name needs confirmation, pass --confirm-public <site-name>.`,
                    null,
                    error.details
                );
            throw error;
        }
        const parsedPreview = PreviewSchema.safeParse(previewResponse);
        if (!parsedPreview.success)
            throw new CommandFailure(
                'failed',
                'Dexto returned an invalid Site publish preview.',
                null
            );
        const preview = parsedPreview.data;
        const description = `${preview.action === 'create' ? 'Create' : 'Update'} ${preview.title} at ${preview.url} (${preview.visibility}: ${WHO_CAN_OPEN[preview.visibility].note}). Preview only; publishing decides again.`;
        if (flag(input, 'dry-run')) {
            context.output.result(
                preview,
                `${description} No Site was published; publishing will decide again.`
            );
            return;
        }
        await requireConsent(
            {
                invocation: context.invocation,
                runtime: { prompt: context.output.json ? null : context.runtime.prompt },
            },
            flag(input, 'yes'),
            description
        );
        if (flag(input, 'yes') && !context.output.json) context.output.note(description);

        const prepared = PreparedSchema.safeParse(
            await queryWorkspaceTool(publishContext, 'dexto_upload_prepare', {
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
        if (!context.output.json)
            context.output.note(`Uploading ${formatBytes(archive.byteLength)}…`);
        await sendBytes(context, { headers, method, url }, new globalThis.Blob([archive]));
        if (!context.output.json) context.output.note(`Publishing ${name}…`);
        let response: unknown;
        try {
            response = await unwrap(
                await client.POST('/v1/sites/publish', {
                    body: {
                        ...call,
                        slug: preview.slug,
                        expectedSiteId: preview.siteId,
                        expectedVisibility: preview.visibility,
                        uploadPath: prepared.data.path,
                    },
                })
            );
        } catch (error) {
            if (error instanceof CloudApiError && error.code === 'needs_confirmation') {
                const changed = z
                    .discriminatedUnion('reason', [
                        z.object({
                            reason: z.literal('visibility_changed'),
                            currentVisibility: VisibilitySchema,
                        }),
                        z.object({
                            reason: z.literal('site_changed'),
                            currentVisibility: VisibilitySchema,
                            currentSiteId: z.string().nullable(),
                        }),
                    ])
                    .safeParse(error.details);
                throw new CommandFailure(
                    'needs_confirmation',
                    changed.success
                        ? changed.data.reason === 'visibility_changed'
                            ? `The Site's visibility changed to ${changed.data.currentVisibility} since the preview.`
                            : `The target changed since the preview: ${changed.data.currentSiteId === null ? 'a new Site' : `Site ${changed.data.currentSiteId}`} with ${changed.data.currentVisibility} visibility.`
                        : `${error.message} Preview the Site again and confirm before publishing.${visibility === 'public' ? ' If the Site name needs confirmation, pass --confirm-public <site-name>.' : ''}`,
                    rerunWith({
                        invocation: context.invocation.filter(
                            (arg) => arg !== '--yes' && arg !== '-y'
                        ),
                    }),
                    error.details
                );
            }
            if (
                error instanceof CloudApiError &&
                error.status === 409 &&
                error.code === 'conflict' &&
                preview.siteId === null &&
                error.message ===
                    `${preview.slug} is taken by another Site. Choose another slug, or delete that Site first if it is yours.`
            )
                throw new CommandFailure(
                    'conflict',
                    'A Site with that name now exists. Re-run to update it.',
                    rerunWith({
                        invocation: context.invocation.filter(
                            (arg) => arg !== '--yes' && arg !== '-y'
                        ),
                    }),
                    error.details
                );
            if (
                error instanceof CloudApiError &&
                error.code === 'conflict' &&
                visibility === 'public'
            )
                throw new CommandFailure(
                    'conflict',
                    `${error.message} If a Site name needs confirmation, pass --confirm-public <site-name>.`,
                    null,
                    error.details
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
        if (flag(input, 'yes') && !context.output.json)
            context.output.note(
                `Site visibility: ${published.visibility}: ${WHO_CAN_OPEN[published.visibility].note}.`
            );
        context.output.result(
            published,
            `${published.created ? 'Published' : 'Updated'} ${name} at ${published.url} (${published.files} file${published.files === 1 ? '' : 's'}). ${WHO_CAN_OPEN[published.visibility].result}`
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
