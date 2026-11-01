// `cloud sandboxes`: create and control project sandboxes, run commands and move files.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unwrap, type CloudClient, type V1Response } from '@dexto/cloud-client';

import {
    argument,
    flag,
    integerOption,
    PAGE_OPTIONS,
    pageQuery,
    requireConsent,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import type { Column } from '../output.js';
import { formatBytes } from './files.js';

type Sandbox = V1Response<'/v1/sandboxes/{sandbox_id}', 'get'>;

/** A sandbox by id, for the calls under /v1/sandboxes/{sandbox_id}. */
function sandboxPath(id: string) {
    return { params: { path: { sandbox_id: id } } };
}

/** A mutation that may be retried without doing it twice. */
function once() {
    return { 'Idempotency-Key': randomUUID() };
}

const COLUMNS: readonly Column<Sandbox>[] = [
    { header: 'id', value: (sandbox) => sandbox.id },
    { header: 'name', value: (sandbox) => sandbox.name },
    { header: 'status', value: (sandbox) => sandbox.status },
    { header: 'size', value: (sandbox) => sandbox.size },
    { header: 'updated', value: (sandbox) => sandbox.updated_at },
];

const list: Command = {
    options: PAGE_OPTIONS,
    path: ['cloud', 'sandboxes', 'list'],
    summary: "List the project's sandboxes.",
    async run(context, input) {
        context.output.list(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/sandboxes', {
                    params: { query: pageQuery(input) },
                })
            ),
            COLUMNS
        );
    },
};

const create: Command = {
    arguments: '<name>',
    options: {
        size: {
            description: 'The sandbox size; large (4 vCPU, 8 GiB) is the only one.',
            type: 'string',
        },
    },
    path: ['cloud', 'sandboxes', 'create'],
    summary: 'Create a sandbox. Start it before running commands in it.',
    async run(context, input) {
        const size = stringOption(input, 'size') ?? 'large';
        if (size !== 'large') throw new UsageError('large is the only sandbox size.');
        const sandbox = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes', {
                params: { header: once() },
                body: { name: argument(input, 0, 'name'), size },
            })
        );
        context.output.result(
            sandbox,
            `Created sandbox ${sandbox.id} (${sandbox.name}), ${sandbox.status}.`
        );
    },
};

const get: Command = {
    arguments: '<sandbox_id>',
    path: ['cloud', 'sandboxes', 'get'],
    summary: 'Show a sandbox.',
    async run(context, input) {
        context.output.record(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/sandboxes/{sandbox_id}', sandboxPath(argument(input, 0, 'sandbox_id')))
            )
        );
    },
};

function lifecycle(action: 'delete' | 'pause' | 'start', summary: string): Command {
    return {
        arguments: '<sandbox_id>',
        ...(action === 'delete' ? { options: YES_OPTION } : {}),
        path: ['cloud', 'sandboxes', action],
        summary,
        async run(context, input) {
            const client: CloudClient = await context.client();
            const id = argument(input, 0, 'sandbox_id');
            if (action === 'delete') {
                await requireConsent(
                    context,
                    flag(input, 'yes'),
                    `Deleting sandbox ${id} deletes its workspace for good.`
                );
                const result = await unwrap(
                    await client.DELETE('/v1/sandboxes/{sandbox_id}', {
                        params: { path: { sandbox_id: id }, header: once() },
                    })
                );
                return context.output.result(result, `Deleted sandbox ${id}.`);
            }
            const request = { params: { path: { sandbox_id: id }, header: once() } };
            const sandbox = await unwrap(
                action === 'start'
                    ? await client.POST('/v1/sandboxes/{sandbox_id}/start', request)
                    : await client.POST('/v1/sandboxes/{sandbox_id}/pause', request)
            );
            context.output.result(sandbox, `Sandbox ${id} is ${sandbox.status}.`);
        },
    };
}

const exec: Command = {
    arguments: '<sandbox_id> <command...>',
    options: {
        cwd: { description: 'The working directory (default /workspace).', type: 'string' },
        timeout: {
            description: 'Milliseconds to wait, up to 120000 (default 60000).',
            type: 'string',
            valueName: 'MS',
        },
    },
    path: ['cloud', 'sandboxes', 'exec'],
    summary:
        'Run a shell command and print its output; exits with its exit code. Put -- before a command with options.',
    async run(context, input) {
        const cwd = stringOption(input, 'cwd');
        const timeout = integerOption(input, 'timeout');
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes/{sandbox_id}/processes', {
                ...sandboxPath(argument(input, 0, 'sandbox_id')),
                body: {
                    command: input.positionals.slice(1).join(' '),
                    ...(cwd === undefined ? {} : { cwd }),
                    ...(timeout === undefined ? {} : { timeout_ms: timeout }),
                },
            })
        );
        if (context.output.jsonContent) {
            context.output.record(result);
            return result.exit_code;
        }
        context.runtime.writeOutput(result.stdout);
        context.runtime.writeError(result.stderr);
        if (result.stdout_truncated || result.stderr_truncated)
            context.output.note('The output was cut short.');
        return result.exit_code;
    },
};

const ls: Command = {
    arguments: '<sandbox_id> [path]',
    options: {
        depth: { description: 'Levels to list (default 1).', type: 'string', valueName: 'N' },
    },
    path: ['cloud', 'sandboxes', 'ls'],
    summary: 'List a sandbox directory (default /workspace).',
    async run(context, input) {
        const directory = input.positionals[1];
        const depth = integerOption(input, 'depth');
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes/{sandbox_id}/files/list', {
                ...sandboxPath(argument(input, 0, 'sandbox_id')),
                body: {
                    ...(directory === undefined ? {} : { path: directory }),
                    ...(depth === undefined ? {} : { depth }),
                },
            })
        );
        context.output.list(result, [
            {
                header: 'path',
                value: (entry) => (entry.is_directory ? `${entry.path}/` : entry.path),
            },
            {
                header: 'size',
                value: (entry) => (entry.is_directory ? null : formatBytes(entry.size)),
            },
            { header: 'modified', value: (entry) => entry.modified_at },
        ]);
        if (result.truncated) context.output.note('The listing was cut short.');
    },
};

const cat: Command = {
    arguments: '<sandbox_id> <path>',
    path: ['cloud', 'sandboxes', 'cat'],
    summary: 'Print a UTF-8 sandbox file of up to 1 MiB.',
    async run(context, input) {
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes/{sandbox_id}/files/read', {
                ...sandboxPath(argument(input, 0, 'sandbox_id')),
                body: { path: argument(input, 1, 'path') },
            })
        );
        if (context.output.jsonContent) return context.output.record(result);
        context.runtime.writeOutput(result.content);
    },
};

const write: Command = {
    arguments: '<sandbox_id> <path>',
    options: {
        from: {
            description: 'Read the content from this local file instead of stdin.',
            type: 'string',
            valueName: 'PATH',
        },
        parents: { description: 'Create missing directories.', short: 'p', type: 'boolean' },
    },
    path: ['cloud', 'sandboxes', 'write'],
    summary: 'Write a UTF-8 sandbox file of up to 1 MiB from stdin or --from.',
    async run(context, input) {
        const from = stringOption(input, 'from');
        const content =
            from === undefined ? await context.runtime.readStdin() : await readFile(from, 'utf8');
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes/{sandbox_id}/files/write', {
                ...sandboxPath(argument(input, 0, 'sandbox_id')),
                body: {
                    content,
                    create_directories: flag(input, 'parents'),
                    path: argument(input, 1, 'path'),
                },
            })
        );
        context.output.result(
            result,
            `Wrote ${formatBytes(result.bytes_written)} to ${result.path}.`
        );
    },
};

const rm: Command = {
    arguments: '<sandbox_id> <path>',
    options: YES_OPTION,
    path: ['cloud', 'sandboxes', 'rm'],
    summary: 'Delete a sandbox file.',
    async run(context, input) {
        const path = argument(input, 1, 'path');
        await requireConsent(context, flag(input, 'yes'), `Deleting ${path} can't be undone.`);
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes/{sandbox_id}/files/delete', {
                ...sandboxPath(argument(input, 0, 'sandbox_id')),
                body: { path },
            })
        );
        context.output.result(result, `Deleted ${path}.`);
    },
};

const importFiles: Command = {
    arguments: '<sandbox_id> <file_id...>',
    options: {
        dir: {
            description: 'The sandbox directory to copy into (default /workspace).',
            type: 'string',
        },
    },
    path: ['cloud', 'sandboxes', 'import'],
    summary: 'Copy project files into a sandbox.',
    async run(context, input) {
        const directory = stringOption(input, 'dir');
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes/{sandbox_id}/files/import', {
                ...sandboxPath(argument(input, 0, 'sandbox_id')),
                body: {
                    file_ids: input.positionals.slice(1),
                    ...(directory === undefined ? {} : { directory }),
                },
            })
        );
        context.output.list(result, [
            { header: 'file', value: (entry) => entry.path },
            { header: 'sandbox path', value: (entry) => entry.sandbox_path },
            { header: 'size', value: (entry) => formatBytes(entry.size_bytes) },
        ]);
    },
};

const exportFile: Command = {
    arguments: '<sandbox_id> <sandbox_path> <file_path>',
    options: {
        overwrite: { description: 'Replace a project file at file_path.', type: 'boolean' },
    },
    path: ['cloud', 'sandboxes', 'export'],
    summary: 'Save a sandbox file as a project file.',
    async run(context, input) {
        const file = await unwrap(
            await (
                await context.client()
            ).POST('/v1/sandboxes/{sandbox_id}/files/export', {
                ...sandboxPath(argument(input, 0, 'sandbox_id')),
                body: {
                    file_path: argument(input, 2, 'file_path'),
                    overwrite: flag(input, 'overwrite'),
                    path: argument(input, 1, 'sandbox_path'),
                },
            })
        );
        context.output.result(file, `Saved ${file.path} (${file.id}).`);
    },
};

export const sandboxCommands: readonly Command[] = [
    list,
    create,
    get,
    lifecycle('start', 'Start or resume a sandbox.'),
    lifecycle('pause', 'Pause a sandbox, keeping its workspace.'),
    lifecycle('delete', 'Delete a sandbox and its workspace.'),
    exec,
    ls,
    cat,
    write,
    rm,
    importFiles,
    exportFile,
];
