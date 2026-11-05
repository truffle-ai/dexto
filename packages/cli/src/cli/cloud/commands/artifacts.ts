// `workspace artifacts`: the person's saved HTML Artifacts, over Dexto's typed Artifacts tools.

import { CommandFailure } from '../../failure.js';

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
    argument,
    choiceOption,
    flag,
    integerOption,
    listOption,
    PAGE_OPTIONS,
    requiredOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

/** What Dexto keeps of one Artifact's HTML. */
const MAX_HTML_BYTES = 524_288;
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
const SURFACES = ['inline', 'panel', 'fullscreen'] as const;
const RENDERERS = ['html', 'reveal'] as const;
const VISIBILITIES = ['private', 'org-shared', 'link-shared'] as const;

const SummarySchema = z.object({
    artifactId: z.string(),
    kind: z.string(),
    preferredSurface: z.string(),
    summary: z.string(),
    title: z.string(),
    updatedAt: z.string(),
});
const ListSchema = z.object({ artifacts: z.array(SummarySchema), next: z.string().nullable() });
const ArtifactSchema = SummarySchema.extend({
    html: z.string(),
    renderer: z.string().nullable(),
});
const GetSchema = z.object({ artifact: ArtifactSchema.nullable() });
const SavedSchema = z.object({
    artifact: z.object({ artifactId: z.string(), title: z.string() }),
});
const SharedSchema = z.object({ url: z.string().nullable(), visibility: z.string() });

type Summary = z.output<typeof SummarySchema>;

const COLUMNS: readonly Column<Summary>[] = [
    { header: 'id', value: (artifact) => artifact.artifactId },
    { header: 'title', value: (artifact) => artifact.title },
    { header: 'kind', value: (artifact) => artifact.kind },
    { header: 'updated', value: (artifact) => artifact.updatedAt },
];

const CONTENT_OPTIONS = {
    kind: { description: `What it is: ${KINDS.join(', ')}.`, type: 'string' },
    renderer: {
        description: 'html, or reveal for a slide-deck written for reveal.js.',
        type: 'string',
    },
    summary: { description: 'One or two lines on what it is.', type: 'string' },
    surface: {
        description: `Where it opens: ${SURFACES.join(', ')}.`,
        type: 'string',
    },
    tag: { description: 'A tag; repeat for more.', multiple: true, type: 'string' },
    title: { description: "The Artifact's title.", type: 'string' },
} as const satisfies Record<string, OptionSpec>;

const DRY_RUN_OPTION = {
    'dry-run': {
        description: 'Check the input and show the call, without making it.',
        type: 'boolean',
    },
} as const satisfies Record<string, OptionSpec>;

const list: Command = {
    options: {
        ...PAGE_OPTIONS,
        chat: { description: 'Only Artifacts produced by this chat id.', type: 'string' },
    },
    path: ['workspace', 'artifacts', 'list'],
    summary: 'List your saved Artifacts, newest first.',
    async run(context, input) {
        await requireLoginScopes(context, ['apps:read']);
        const after = stringOption(input, 'after');
        const limit = integerOption(input, 'limit');
        const sessionId = stringOption(input, 'chat');
        const page = ListSchema.parse(
            await queryWorkspaceTool(context, 'dexto_artifacts_list', {
                ...(after === undefined ? {} : { cursor: after }),
                ...(limit === undefined ? {} : { limit }),
                ...(sessionId === undefined ? {} : { sessionId }),
            })
        );
        context.output.list(
            { data: page.artifacts, has_more: page.next !== null, next_after: page.next },
            COLUMNS
        );
    },
};

const get: Command = {
    arguments: '<artifact_id>',
    options: {
        out: {
            description: 'Write the HTML to this file, and show the rest without it.',
            type: 'string',
            valueName: 'PATH',
        },
    },
    path: ['workspace', 'artifacts', 'get'],
    summary: 'Show one Artifact, with its HTML or with --out writing the HTML to a file.',
    async run(context, input) {
        await requireLoginScopes(context, ['apps:read']);
        const artifact = await readArtifact(context, argument(input, 0, 'artifact_id'));
        const out = stringOption(input, 'out');
        if (out === undefined) return context.output.record(artifact);
        await writeFile(out, artifact.html, 'utf8');
        const { html: _html, ...rest } = artifact;
        context.output.record({ ...rest, htmlPath: path.resolve(out) });
    },
};

const create: Command = {
    arguments: '<file>',
    options: {
        ...CONTENT_OPTIONS,
        collection: {
            description: 'A collection to put it in, by id; repeat for more.',
            multiple: true,
            type: 'string',
        },
        'idempotency-key': {
            description:
                'Any string unique to this Artifact: running again with the same key returns the first one instead of a copy.',
            type: 'string',
            valueName: 'KEY',
        },
        ...DRY_RUN_OPTION,
        ...YES_OPTION,
    },
    path: ['workspace', 'artifacts', 'create'],
    summary:
        "Save an HTML file (or - for stdin) as an Artifact in your library. Its title defaults to the file's name.",
    async run(context, input) {
        await requireLoginScopes(context, ['apps:execute']);
        const file = argument(input, 0, 'file');
        const title =
            stringOption(input, 'title') ??
            (file === '-' ? requiredOption(input, 'title') : path.parse(file).name);
        const key = stringOption(input, 'idempotency-key');
        const collections = listOption(input, 'collection');
        const call = {
            ...contentFields(input, {
                kind: 'document',
                preferredSurface: 'panel',
                renderer: 'html',
                summary: '',
                title,
            }),
            html: await readHtml(context, file),
            ...(collections.length === 0 ? {} : { collectionIds: collections }),
            ...(key === undefined ? {} : { idempotencyKey: key }),
        };
        const saved = await save(context, input, 'dexto_artifacts_create', call, `Save ${title}`);
        if (saved === null) return;
        context.output.result(
            saved.value,
            `Saved ${saved.artifact.title} as Artifact ${saved.artifact.artifactId}.`
        );
    },
};

const replace: Command = {
    arguments: '<artifact_id> <file>',
    options: { ...CONTENT_OPTIONS, ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['workspace', 'artifacts', 'replace'],
    summary:
        'Replace an Artifact with an HTML file (or - for stdin), keeping its id; it keeps its title, kind, summary, surface and renderer unless you give new ones.',
    async run(context, input) {
        await requireLoginScopes(context, ['apps:read', 'apps:execute']);
        const artifactId = argument(input, 0, 'artifact_id');
        const html = await readHtml(context, argument(input, 1, 'file'));
        const current = await readArtifact(context, artifactId);
        const call = {
            artifactId,
            ...contentFields(input, {
                kind: current.kind,
                preferredSurface: current.preferredSurface,
                renderer: current.renderer ?? 'html',
                summary: current.summary,
                title: current.title,
            }),
            html,
        };
        const saved = await save(
            context,
            input,
            'dexto_artifacts_replace',
            call,
            `Replace Artifact ${artifactId}`
        );
        if (saved === null) return;
        context.output.result(saved.value, `Replaced Artifact ${artifactId}.`);
    },
};

const share: Command = {
    arguments: '<artifact_id>',
    options: {
        visibility: {
            description:
                'private (only you), org-shared (your organization) or link-shared (anyone with the link).',
            type: 'string',
        },
        ...DRY_RUN_OPTION,
        ...YES_OPTION,
    },
    path: ['workspace', 'artifacts', 'share'],
    summary:
        'Change who can open an Artifact: only you, your organization, or anyone with its link.',
    async run(context, input) {
        await requireLoginScopes(context, ['apps:execute']);
        const visibility = choiceOption(input, 'visibility', VISIBILITIES);
        if (visibility === undefined) throw new UsageError('--visibility is required.');
        const artifactId = argument(input, 0, 'artifact_id');
        const call = { artifactId, visibility };
        const tool = await requireTool(context, 'dexto_artifacts_share');
        if (flag(input, 'dry-run')) return dryRun(context, 'dexto_artifacts_share', call);
        const agreed = await agreeToCall(
            context,
            {
                level: toolCallLevel(tool, call),
                schema: tool.inputSchema,
                title: `Make Artifact ${artifactId} ${visibility}`,
            },
            flag(input, 'yes')
        );
        const value = await queryWorkspaceTool(context, 'dexto_artifacts_share', {
            ...call,
            ...agreed,
        });
        const shared = SharedSchema.parse(value);
        context.output.result(
            value,
            shared.url === null
                ? `Artifact ${artifactId} is now ${shared.visibility}.`
                : `Artifact ${artifactId} is now ${shared.visibility}: ${shared.url}`
        );
    },
};

async function readArtifact(context: CommandContext, artifactId: string) {
    const { artifact } = GetSchema.parse(
        await queryWorkspaceTool(context, 'dexto_artifacts_get', { artifactId })
    );
    if (artifact === null)
        throw new CommandFailure('not_found', `There is no Artifact ${artifactId}.`, null);
    return artifact;
}

/** The HTML of a file, or of stdin for -, checked against what an Artifact holds. */
async function readHtml(context: CommandContext, file: string): Promise<string> {
    const html = file === '-' ? await context.runtime.readStdin() : await readFile(file, 'utf8');
    if (html.length === 0) throw new UsageError(`${file === '-' ? 'stdin' : file} is empty.`);
    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes > MAX_HTML_BYTES)
        throw new UsageError(
            `The HTML is ${bytes} bytes; an Artifact holds up to ${MAX_HTML_BYTES}.`
        );
    return html;
}

/** The content flags given, each falling back to `defaults`. */
function contentFields(
    input: CommandInput,
    defaults: {
        kind: string;
        preferredSurface: string;
        renderer: string;
        summary: string;
        title: string;
    }
) {
    const tags = listOption(input, 'tag');
    const fields = {
        kind: choiceOption(input, 'kind', KINDS) ?? defaults.kind,
        preferredSurface: choiceOption(input, 'surface', SURFACES) ?? defaults.preferredSurface,
        renderer: choiceOption(input, 'renderer', RENDERERS) ?? defaults.renderer,
        summary: stringOption(input, 'summary') ?? defaults.summary,
        title: stringOption(input, 'title') ?? defaults.title,
        ...(tags.length === 0 ? {} : { tags }),
    };
    if (fields.renderer === 'reveal' && fields.kind !== 'slide-deck')
        throw new UsageError('--renderer reveal needs --kind slide-deck.');
    return fields;
}

async function requireTool(context: CommandContext, name: string) {
    const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
    if (tool === undefined)
        throw new CommandFailure('failed', "This Dexto can't manage Artifacts yet.", null);
    return tool;
}

/** Creates or replaces once agreed, or with --dry-run shows the call; null when it only showed it. */
async function save(
    context: CommandContext,
    input: CommandInput,
    name: string,
    call: Record<string, unknown>,
    title: string
): Promise<{ artifact: z.output<typeof SavedSchema>['artifact']; value: unknown } | null> {
    const tool = await requireTool(context, name);
    if (flag(input, 'dry-run')) {
        dryRun(context, name, call);
        return null;
    }
    const agreed = await agreeToCall(
        context,
        { level: toolCallLevel(tool, call), schema: tool.inputSchema, title },
        flag(input, 'yes')
    );
    const value = await queryWorkspaceTool(context, name, { ...call, ...agreed });
    return { artifact: SavedSchema.parse(value).artifact, value };
}

/** The call a write would make, its HTML shown by size. */
function dryRun(context: CommandContext, tool: string, call: Record<string, unknown>): void {
    const { html, ...rest } = call;
    const shown =
        typeof html === 'string' ? { ...rest, htmlBytes: Buffer.byteLength(html, 'utf8') } : rest;
    context.output.result(
        { dryRun: true, tool, arguments: shown },
        `Would call ${tool} with ${JSON.stringify(shown)}.`
    );
}

export const artifactCommands: readonly Command[] = [list, get, create, replace, share];
