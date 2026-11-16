import { unwrap, type paths, type V1Response } from '@dexto/cloud-client';
import { CommandFailure } from '../../failure.js';
import {
    argument,
    BODY_OPTIONS,
    flag,
    isJsonObject,
    readJsonBody,
    signInCommand,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import type { Column } from '../output.js';

type Create = paths['/v1/environments']['post']['requestBody']['content']['application/json'];
type Environment = V1Response<'/v1/environments', 'get'>['data'][number];
type Build = NonNullable<Environment['latest_build']>;
const columns: readonly Column<Environment>[] = [
    { header: 'id', value: (row) => row.id },
    { header: 'name', value: (row) => row.name },
    { header: 'visibility', value: (row) => row.visibility },
    { header: 'default', value: (row) => (row.is_default ? 'yes' : '') },
    { header: 'state', value: (row) => row.state },
    { header: 'latest build', value: (row) => label(row.latest_build) },
];
const buildColumns: readonly Column<Build>[] = [
    { header: 'id', value: (row) => row.id },
    { header: '#', value: (row) => String(row.number) },
    { header: 'status', value: (row) => row.status },
    { header: 'trigger', value: (row) => row.trigger },
    { header: 'created', value: (row) => row.created_at },
    { header: 'finished', value: (row) => row.finished_at },
    { header: 'error', value: (row) => row.error },
];
const options = {
    data: {
        ...BODY_OPTIONS.data,
        description:
            'The Environment spec as JSON, e.g. {"repos":[{"repository":"owner/name","ref":"main"}]}.',
    },
    file: {
        ...BODY_OPTIONS.file,
        description: 'Read the Environment spec as JSON from a file, or - for stdin.',
    },
    visibility: { type: 'string', description: 'personal or team' },
    'dry-run': { type: 'boolean', description: 'Show the request without sending it.' },
} as const;

async function person(context: CommandContext) {
    const connection = await context.connection();
    if (connection.kind !== 'oauth') {
        const fix = {
            environment: 'Unset DEXTO_API_KEY, which takes precedence over a saved sign-in',
            flag: 'Drop --api-key',
            login: 'This profile is signed in with a key',
        }[connection.source];
        throw new CommandFailure(
            'needs_sign_in',
            `Environments need a person's sign-in, not an API key. ${fix}; sign in as yourself.`,
            signInCommand(context, null)
        );
    }
    return context.client();
}
function label(build: Build | null): string {
    return build === null ? 'none' : `#${build.number} ${build.status}`;
}
function visibility(input: CommandInput): 'personal' | 'team' | undefined {
    const value = stringOption(input, 'visibility');
    if (value === undefined || value === 'personal' || value === 'team') return value;
    throw new UsageError('--visibility is personal or team.');
}
async function spec(context: CommandContext, input: CommandInput): Promise<Create['spec'] | null> {
    const value = await readJsonBody(context, input);
    if (value === null) return null;
    if (!isSpec(value)) throw new UsageError('The spec is a JSON object with a "repos" list.');
    return value;
}
function isSpec(value: unknown): value is Create['spec'] {
    return isJsonObject(value) && Array.isArray(value.repos);
}
function dryRun(context: CommandContext, method: string, path: string, body: unknown) {
    context.output.result(
        { dry_run: true, request: { method, path, body } },
        `Would send ${method} ${path}${body === null ? '' : ` ${JSON.stringify(body)}`}.`
    );
}
const list: Command = {
    path: ['cloud', 'environments', 'list'],
    summary: 'List the Environments you can read.',
    async run(context) {
        context.output.list(
            await unwrap(await (await person(context)).GET('/v1/environments')),
            columns
        );
    },
};
const get: Command = {
    path: ['cloud', 'environments', 'get'],
    arguments: '<environment_id>',
    summary: 'Show an Environment.',
    async run(context, input) {
        const environment_id = argument(input, 0, 'environment_id');
        context.output.record(
            await unwrap(
                await (
                    await person(context)
                ).GET('/v1/environments/{environment_id}', { params: { path: { environment_id } } })
            )
        );
    },
};
const create: Command = {
    path: ['cloud', 'environments', 'create'],
    arguments: '<name>',
    options,
    summary: 'Create an Environment and queue its first build.',
    async run(context, input) {
        const value = await spec(context, input);
        if (value === null) throw new UsageError('Pass the spec with --data or --file.');
        const name = argument(input, 0, 'name');
        const v = visibility(input);
        const body = { name, spec: value, ...(v === undefined ? {} : { visibility: v }) };
        if (flag(input, 'dry-run')) return dryRun(context, 'POST', '/v1/environments', body);
        const row = await unwrap(await (await person(context)).POST('/v1/environments', { body }));
        context.output.result(
            row,
            `Created Environment ${row.id} (${row.name}); build ${label(row.latest_build)}.`
        );
    },
};
const update: Command = {
    path: ['cloud', 'environments', 'update'],
    arguments: '<environment_id>',
    options: { ...options, name: { type: 'string', description: 'Rename it.' } },
    summary: 'Change an Environment.',
    async run(context, input) {
        const environment_id = argument(input, 0, 'environment_id');
        const name = stringOption(input, 'name');
        const value = await spec(context, input);
        const v = visibility(input);
        if (name === undefined && value === null && v === undefined)
            throw new UsageError('Pass --name, --visibility, or a spec with --data or --file.');
        const body = {
            ...(name === undefined ? {} : { name }),
            ...(value === null ? {} : { spec: value }),
            ...(v === undefined ? {} : { visibility: v }),
        };
        if (flag(input, 'dry-run'))
            return dryRun(
                context,
                'PATCH',
                `/v1/environments/${encodeURIComponent(environment_id)}`,
                body
            );
        const row = await unwrap(
            await (
                await person(context)
            ).PATCH('/v1/environments/{environment_id}', {
                params: { path: { environment_id } },
                body,
            })
        );
        context.output.result(row, `Updated Environment ${row.id}.`);
    },
};
const rebuild: Command = {
    path: ['cloud', 'environments', 'rebuild'],
    arguments: '<environment_id>',
    options: { 'dry-run': options['dry-run'] },
    summary: 'Queue a build of an Environment.',
    async run(context, input) {
        const environment_id = argument(input, 0, 'environment_id');
        if (flag(input, 'dry-run'))
            return dryRun(
                context,
                'POST',
                `/v1/environments/${encodeURIComponent(environment_id)}/rebuild`,
                null
            );
        const row = await unwrap(
            await (
                await person(context)
            ).POST('/v1/environments/{environment_id}/rebuild', {
                params: { path: { environment_id } },
            })
        );
        context.output.result(row, `Queued build ${label(row)}.`);
    },
};
const listBuilds: Command = {
    path: ['cloud', 'environments', 'builds', 'list'],
    arguments: '<environment_id>',
    summary: 'List an Environment’s latest builds.',
    async run(context, input) {
        const environment_id = argument(input, 0, 'environment_id');
        context.output.list(
            await unwrap(
                await (
                    await person(context)
                ).GET('/v1/environments/{environment_id}/builds', {
                    params: { path: { environment_id } },
                })
            ),
            buildColumns
        );
    },
};
const getBuild: Command = {
    path: ['cloud', 'environments', 'builds', 'get'],
    arguments: '<environment_id> <build_id>',
    summary: 'Show a build and its log.',
    async run(context, input) {
        const environment_id = argument(input, 0, 'environment_id');
        const build_id = argument(input, 1, 'build_id');
        context.output.record(
            await unwrap(
                await (
                    await person(context)
                ).GET('/v1/environments/{environment_id}/builds/{build_id}', {
                    params: { path: { environment_id, build_id } },
                })
            )
        );
    },
};
export const environmentCommands: readonly Command[] = [
    list,
    get,
    create,
    update,
    rebuild,
    listBuilds,
    getBuild,
];
