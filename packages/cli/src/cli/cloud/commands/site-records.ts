// `workspace sites collections` and `workspace sites records`: a Site's data collections and their
// records, over Dexto's Site data tools.

import { CommandFailure } from '../../failure.js';

import { z } from 'zod';

import {
    argument,
    BODY_OPTIONS,
    flag,
    integerOption,
    readJsonBody,
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

/** The most records one list returns, as the Site records tool allows. */
const MAX_LIMIT = 100;

const RecordSchema = z
    .object({
        createdAt: z.string(),
        id: z.string(),
        updatedAt: z.string(),
        value: z.unknown(),
    })
    .passthrough();
const ListSchema = z.object({ records: z.array(RecordSchema) }).passthrough();
const OneSchema = z.object({ record: RecordSchema }).passthrough();

const CollectionSchema = z
    .object({
        access: z.object({
            create: z.string(),
            delete: z.string(),
            read: z.string(),
            update: z.string(),
        }),
        name: z.string(),
    })
    .passthrough();
const CollectionsSchema = z.object({ collections: z.array(CollectionSchema) }).passthrough();

const COLLECTION_COLUMNS: readonly Column<z.output<typeof CollectionSchema>>[] = [
    { header: 'name', value: (collection) => collection.name },
    { header: 'read', value: (collection) => collection.access.read },
    { header: 'create', value: (collection) => collection.access.create },
    { header: 'update', value: (collection) => collection.access.update },
    { header: 'delete', value: (collection) => collection.access.delete },
];

const COLUMNS: readonly Column<z.output<typeof RecordSchema>>[] = [
    { header: 'id', value: (record) => record.id },
    { header: 'updated', value: (record) => record.updatedAt },
    { header: 'value', value: (record) => JSON.stringify(record.value) },
];

const VALUE_OPTIONS = {
    data: {
        description: "The record's value as JSON; it must match the collection's schema.",
        type: 'string',
        valueName: 'JSON',
    },
    file: {
        ...BODY_OPTIONS.file,
        description: "Read the record's value from a JSON file, or - for stdin.",
    },
} as const satisfies Record<string, OptionSpec>;

const DRY_RUN_OPTION = {
    'dry-run': {
        description: 'Check the input and show the call, without making it.',
        type: 'boolean',
    },
} as const satisfies Record<string, OptionSpec>;

const uuid = z.string().uuid();

/** A Site or record id, checked before anything is sent. */
function idArgument(input: CommandInput, index: number, name: string): string {
    const value = argument(input, index, name);
    if (!uuid.safeParse(value).success) throw new UsageError(`<${name}> must be a UUID.`);
    return value;
}

/** Where a record lives: its Site and collection, from the first two arguments. */
function collectionOf(input: CommandInput): { collection: string; siteId: string } {
    const collection = argument(input, 1, 'collection').trim();
    if (collection.length === 0) throw new UsageError('<collection> is empty.');
    return { collection, siteId: idArgument(input, 0, 'site_id') };
}

/** The record's value from --data or --file; one of them is required. */
async function readRecordValue(context: CommandContext, input: CommandInput): Promise<unknown> {
    if (stringOption(input, 'data') === undefined && stringOption(input, 'file') === undefined)
        throw new UsageError("Pass the record's value as JSON with --data or --file.");
    return await readJsonBody(context, input);
}

const collections: Command = {
    arguments: '<site_id>',
    examples: ['dexto workspace sites collections list "$SITE_ID" --json'],
    path: ['workspace', 'sites', 'collections', 'list'],
    summary:
        "List the managed data collections of a Site you own, with each one's schema and access policy.",
    async run(context, input) {
        const siteId = idArgument(input, 0, 'site_id');
        await requireLoginScopes(context, ['sites:read']);
        const value = await queryWorkspaceTool(context, 'dexto_site_collections_list', { siteId });
        if (context.output.json) return context.output.record(value);
        context.output.list(
            { data: CollectionsSchema.parse(value).collections },
            COLLECTION_COLUMNS
        );
    },
};

const list: Command = {
    arguments: '<site_id> <collection>',
    examples: ['dexto workspace sites records list "$SITE_ID" signups --limit 20 --json'],
    options: {
        limit: {
            description: `How many to return, 1 to ${MAX_LIMIT}; the tool's default is 50.`,
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['workspace', 'sites', 'records', 'list'],
    summary: 'List the records in one collection of a Site you own, private records included.',
    async run(context, input) {
        const where = collectionOf(input);
        const limit = integerOption(input, 'limit');
        if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT))
            throw new UsageError(`--limit must be between 1 and ${MAX_LIMIT}.`);
        await requireLoginScopes(context, ['sites:read']);
        const value = await queryWorkspaceTool(context, 'dexto_site_records_list', {
            ...where,
            ...(limit === undefined ? {} : { limit }),
        });
        if (context.output.json) return context.output.record(value);
        context.output.list({ data: ListSchema.parse(value).records }, COLUMNS);
    },
};

const get: Command = {
    arguments: '<site_id> <collection> <record_id>',
    examples: ['dexto workspace sites records get "$SITE_ID" signups "$RECORD_ID" --json'],
    path: ['workspace', 'sites', 'records', 'get'],
    summary: 'Show one record of a Site collection you own.',
    async run(context, input) {
        const call = { ...collectionOf(input), recordId: idArgument(input, 2, 'record_id') };
        await requireLoginScopes(context, ['sites:read']);
        const value = await queryWorkspaceTool(context, 'dexto_site_record_get', call);
        if (context.output.json) return context.output.record(value);
        context.output.record(OneSchema.parse(value).record);
    },
};

const create: Command = {
    arguments: '<site_id> <collection>',
    examples: [
        'dexto workspace sites records create "$SITE_ID" signups --data \'{"email":"a@example.com"}\' --yes --json',
    ],
    options: { ...VALUE_OPTIONS, ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['workspace', 'sites', 'records', 'create'],
    summary: 'Add a record to a collection of a Site you created. Asks first.',
    async run(context, input) {
        const where = collectionOf(input);
        const call = { ...where, value: await readRecordValue(context, input) };
        const record = await write(
            context,
            input,
            'dexto_site_record_create',
            call,
            `Add a record to ${where.collection}`
        );
        if (record !== null) context.output.result(record.value, `Created record ${record.id}.`);
    },
};

const update: Command = {
    arguments: '<site_id> <collection> <record_id>',
    examples: [
        'dexto workspace sites records update "$SITE_ID" signups "$RECORD_ID" --file record.json --yes --json',
    ],
    options: { ...VALUE_OPTIONS, ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['workspace', 'sites', 'records', 'update'],
    summary: "Replace one record's value in a collection of a Site you created. Asks first.",
    async run(context, input) {
        const where = collectionOf(input);
        const recordId = idArgument(input, 2, 'record_id');
        const call = { ...where, recordId, value: await readRecordValue(context, input) };
        const record = await write(
            context,
            input,
            'dexto_site_record_update',
            call,
            `Replace record ${recordId} in ${where.collection}`
        );
        if (record !== null) context.output.result(record.value, `Updated record ${record.id}.`);
    },
};

const remove: Command = {
    arguments: '<site_id> <collection> <record_id>',
    examples: ['dexto workspace sites records delete "$SITE_ID" signups "$RECORD_ID" --yes --json'],
    options: { ...DRY_RUN_OPTION, ...YES_OPTION },
    path: ['workspace', 'sites', 'records', 'delete'],
    summary: 'Delete one record from a collection of a Site you created. Asks first.',
    async run(context, input) {
        const where = collectionOf(input);
        const recordId = idArgument(input, 2, 'record_id');
        const record = await write(
            context,
            input,
            'dexto_site_record_delete',
            { ...where, recordId },
            `Delete record ${recordId} from ${where.collection}`
        );
        if (record !== null) context.output.result(record.value, `Deleted record ${record.id}.`);
    },
};

/**
 * Makes a record write once the person agrees, as the tool's own level asks, or with --dry-run
 * shows the call instead; null when it only showed it.
 */
async function write(
    context: CommandContext,
    input: CommandInput,
    name: string,
    call: Record<string, unknown>,
    title: string
): Promise<{ id: string; value: unknown } | null> {
    if (flag(input, 'dry-run')) {
        context.output.result(
            { dryRun: true, tool: name, arguments: call },
            `Would call ${name} with ${JSON.stringify(call)}.`
        );
        return null;
    }
    await requireLoginScopes(context, ['sites:write']);
    const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
    if (tool === undefined)
        throw new CommandFailure('failed', "This Dexto can't change Site records yet.", null);
    const agreed = await agreeToCall(
        context,
        { level: toolCallLevel(tool, call), schema: tool.inputSchema, title },
        flag(input, 'yes')
    );
    const value = await queryWorkspaceTool(context, name, { ...call, ...agreed });
    return { id: OneSchema.parse(value).record.id, value };
}

export const siteRecordCommands: readonly Command[] = [
    collections,
    list,
    get,
    create,
    update,
    remove,
];
