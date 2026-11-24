import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unwrap, type V1Response } from '@dexto/cloud-client';
import {
    argument,
    choiceOption,
    flag,
    PAGE_OPTIONS,
    pageQuery,
    requiredOption,
    UsageError,
    type Command,
} from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';

const KINDS = [
    'document',
    'plan',
    'mockup',
    'prototype',
    'slide-deck',
    'visualization',
    'interactive',
    'other',
] as const;
type Artifact = V1Response<'/v1/artifacts/{id}', 'get'>;
const COLUMNS: readonly Column<Artifact>[] = [
    { header: 'id', value: (artifact) => artifact.id },
    { header: 'title', value: (artifact) => artifact.title },
    { header: 'url', value: (artifact) => artifact.url ?? '' },
];

const publish: Command = {
    arguments: '<file>',
    options: {
        title: { description: 'Title of the Artifact.', type: 'string' },
        kind: { description: `Artifact kind: ${KINDS.join(', ')}.`, type: 'string' },
        'dry-run': { description: 'Check the file without publishing.', type: 'boolean' },
    },
    path: ['artifacts', 'publish'],
    summary:
        'Publish HTML to your organization. Example: dexto artifacts publish report.html --title "Report"',
    async run(context, input) {
        const file = argument(input, 0, 'file');
        const title = requiredOption(input, 'title');
        const kind = choiceOption(input, 'kind', KINDS);
        const bytes = await readFile(file).catch(() => {
            throw new UsageError(`Cannot read ${file}.`);
        });
        const html = bytes.toString('utf8');
        if (!html.length) throw new UsageError(`${file} is empty.`);
        if (Buffer.byteLength(html, 'utf8') > 524_288)
            throw new UsageError('An Artifact holds at most 524288 bytes of HTML.');
        if (flag(input, 'dry-run')) {
            context.output.result(
                {
                    dryRun: true,
                    title,
                    htmlBytes: Buffer.byteLength(html),
                    ...(kind === undefined ? {} : { kind }),
                },
                `Would publish ${title}.`
            );
            return;
        }
        const fileHash = createHash('sha256').update(bytes).digest('hex');
        const idempotencyKey = createHash('sha256')
            .update(JSON.stringify([title, fileHash, kind ?? 'document']))
            .digest('hex');
        await requireLoginScopes(context, ['artifacts:write']);
        const artifact = await unwrap(
            await (
                await context.client()
            ).POST('/v1/artifacts', {
                body: {
                    title,
                    html,
                    idempotency_key: idempotencyKey,
                    ...(kind === undefined ? {} : { kind }),
                },
            })
        );
        context.output.result(artifact, `${artifact.id} ${artifact.url ?? ''}`);
    },
};
const list: Command = {
    options: PAGE_OPTIONS,
    path: ['artifacts', 'list'],
    summary: 'List your Artifacts. Example: dexto artifacts list --json',
    async run(context, input) {
        await requireLoginScopes(context, ['artifacts:read']);
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/artifacts', { params: { query: pageQuery(input) } })
        );
        context.output.list(page, COLUMNS);
    },
};
const open: Command = {
    arguments: '<id>',
    path: ['artifacts', 'open'],
    summary: 'Print an Artifact link. Example: dexto artifacts open "$ARTIFACT_ID"',
    async run(context, input) {
        await requireLoginScopes(context, ['artifacts:read']);
        const artifact = await unwrap(
            await (
                await context.client()
            ).GET('/v1/artifacts/{id}', { params: { path: { id: argument(input, 0, 'id') } } })
        );
        context.output.result(artifact, artifact.url ?? `No link for ${artifact.id}.`);
    },
};
export const publicArtifactCommands: readonly Command[] = [publish, list, open];
