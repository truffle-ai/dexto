// `cloud secrets`: credentials the project's agents use without ever seeing them.

import { unwrap, type V1Body, type V1Response } from '@dexto/cloud-client';
import {
    argument,
    flag,
    listOption,
    PAGE_OPTIONS,
    pageQuery,
    readValue,
    requireConsent,
    stringOption,
    YES_OPTION,
    type Command,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import type { Column } from '../output.js';

type Secret = V1Response<'/v1/secrets', 'get'>['data'][number];
type Placement = V1Body<'/v1/secrets', 'post'>['placement'];

const COLUMNS: readonly Column<Secret>[] = [
    { header: 'id', value: (secret) => secret.id },
    { header: 'name', value: (secret) => secret.name },
    { header: 'hosts', value: (secret) => secret.hosts.join(',') },
    { header: 'hint', value: (secret) => secret.hint },
    { header: 'last used', value: (secret) => secret.last_used_at },
];

const PLACEMENT_OPTIONS = {
    header: {
        description: 'Send the value in this header instead of Authorization: Bearer.',
        type: 'string',
        valueName: 'NAME',
    },
    host: {
        description: 'A public hostname the value may be sent to; repeat for more.',
        multiple: true,
        type: 'string',
    },
    prefix: { description: "Text before the value in --header, such as 'Token '.", type: 'string' },
} as const satisfies Record<string, OptionSpec>;

const list: Command = {
    options: PAGE_OPTIONS,
    path: ['cloud', 'secrets', 'list'],
    summary: "List the project's secrets. Values are never shown.",
    async run(context, input) {
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/secrets', { params: { query: pageQuery(input) } })
        );
        context.output.list(page, COLUMNS);
    },
};

const get: Command = {
    arguments: '<secret_id>',
    path: ['cloud', 'secrets', 'get'],
    summary: 'Show a secret, without its value.',
    async run(context, input) {
        context.output.record(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/secrets/{secret_id}', {
                    params: { path: { secret_id: argument(input, 0, 'secret_id') } },
                })
            )
        );
    },
};

const create: Command = {
    arguments: '<name>',
    options: PLACEMENT_OPTIONS,
    path: ['cloud', 'secrets', 'create'],
    summary:
        'Create a secret. Type the value when asked, or pipe it on stdin; it is never an argument.',
    async run(context, input) {
        const value = await readValue(context, 'Value: ', true);
        const secret = await unwrap(
            await (
                await context.client()
            ).POST('/v1/secrets', {
                body: {
                    hosts: listOption(input, 'host'),
                    name: argument(input, 0, 'name'),
                    placement: placement(input) ?? { type: 'bearer' },
                    value,
                },
            })
        );
        context.output.result(secret, `Created secret ${secret.id} (${secret.name}).`);
    },
};

const update: Command = {
    arguments: '<secret_id>',
    options: {
        ...PLACEMENT_OPTIONS,
        value: {
            description: 'Replace the value: type it when asked, or pipe it.',
            type: 'boolean',
        },
    },
    path: ['cloud', 'secrets', 'update'],
    summary: "Change a secret's hosts, placement or value.",
    async run(context, input) {
        const hosts = listOption(input, 'host');
        const newPlacement = placement(input);
        const value = flag(input, 'value')
            ? await readValue(context, 'New value: ', true)
            : undefined;
        const secret = await unwrap(
            await (
                await context.client()
            ).PATCH('/v1/secrets/{secret_id}', {
                params: { path: { secret_id: argument(input, 0, 'secret_id') } },
                body: {
                    ...(hosts.length === 0 ? {} : { hosts }),
                    ...(newPlacement === null ? {} : { placement: newPlacement }),
                    ...(value === undefined ? {} : { value }),
                },
            })
        );
        context.output.result(secret, `Updated secret ${secret.id}.`);
    },
};

const remove: Command = {
    arguments: '<secret_id>',
    options: YES_OPTION,
    path: ['cloud', 'secrets', 'delete'],
    summary: 'Delete a secret. Refused while an active agent uses it.',
    async run(context, input) {
        const id = argument(input, 0, 'secret_id');
        await requireConsent(context, flag(input, 'yes'), `Deleting secret ${id} can't be undone.`);
        const result = await unwrap(
            await (
                await context.client()
            ).DELETE('/v1/secrets/{secret_id}', {
                params: { path: { secret_id: id } },
            })
        );
        context.output.result(result, `Deleted secret ${id}.`);
    },
};

function placement(input: CommandInput): Placement | null {
    const header = stringOption(input, 'header');
    if (header === undefined) return null;
    const prefix = stringOption(input, 'prefix');
    return { name: header, type: 'header', ...(prefix === undefined ? {} : { prefix }) };
}

export const secretCommands: readonly Command[] = [list, get, create, update, remove];
