// `workspace functions`: the managed Functions your sign-in can reach, read and invoke over the
// Dexto MCP. `cloud functions` is the separate Cloud project's /v1 API.

import { z } from 'zod';

import { CommandFailure, type FailureKind } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    BODY_OPTIONS,
    flag,
    integerOption,
    isJsonObject,
    readJsonBody,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const FunctionSchema = z
    .object({
        id: z.string(),
        slug: z.string(),
        title: z.string(),
        access: z.string(),
        owned: z.boolean(),
        operations: z.array(z.string()),
        invocation: z.object({ availability: z.string() }).passthrough(),
    })
    .passthrough();

/** The proxy's answer: the Function's response, or why Dexto didn't reach it. */
const InvocationSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('response'),
            status: z.number(),
            body: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('json'), value: z.unknown() }),
                z.object({ kind: z.literal('text'), value: z.string() }),
            ]),
        })
        .passthrough(),
    z
        .object({
            kind: z.literal('error'),
            error: z.object({ code: z.string(), message: z.string() }).passthrough(),
        })
        .passthrough(),
]);

/** How each proxy error code fails the command; the rest are plain failures. */
const INVOCATION_FAILURES: Readonly<Record<string, FailureKind>> = {
    forbidden: 'needs_permission',
    invalid_request: 'invalid_input',
    not_found: 'not_found',
};

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

/** An integer option within the operation's own bounds, so a bad value never reaches Dexto. */
function boundedOption(
    input: CommandInput,
    name: string,
    min: number,
    max: number
): number | undefined {
    const value = integerOption(input, name);
    if (value !== undefined && (value < min || value > max))
        throw new UsageError(`--${name} must be between ${min} and ${max}.`);
    return value;
}

const list: Command = {
    path: ['workspace', 'functions', 'list'],
    summary:
        'List the Functions you own or can invoke, with their MCP and OpenAPI interfaces and whether you can invoke them.',
    options: {
        limit: { type: 'string', valueName: 'N', description: 'At most N Functions (1-50).' },
    },
    async run(context, input) {
        const limit = boundedOption(input, 'limit', 1, 50);
        await requireLoginScopes(context, ['functions:read']);
        const result = parsed(
            z.object({ services: z.array(FunctionSchema) }).passthrough(),
            await queryWorkspaceTool(
                context,
                'dexto_functions_list',
                limit === undefined ? {} : { limit }
            ),
            'Function list'
        );
        context.output.list({ data: result.services }, [
            { header: 'id', value: (each) => each.id },
            { header: 'slug', value: (each) => each.slug },
            { header: 'title', value: (each) => each.title },
            { header: 'owned', value: (each) => each.owned },
            { header: 'access', value: (each) => each.access },
            { header: 'invoke', value: (each) => each.invocation.availability },
            { header: 'operations', value: (each) => each.operations.join(',') },
        ]);
    },
};

const get: Command = {
    path: ['workspace', 'functions', 'get'],
    arguments: '<function_id>',
    summary: 'Show a Function you own and the status of its recent deployments.',
    options: {
        deployments: {
            type: 'string',
            valueName: 'N',
            description: 'Show at most N recent deployments (1-50, default 20).',
        },
    },
    async run(context, input) {
        const projectId = argument(input, 0, 'function_id');
        const deploymentLimit = boundedOption(input, 'deployments', 1, 50);
        await requireLoginScopes(context, ['functions:read']);
        context.output.record(
            await queryWorkspaceTool(context, 'dexto_function_get', {
                projectId,
                ...(deploymentLimit === undefined ? {} : { deploymentLimit }),
            })
        );
    },
};

const invoke: Command = {
    path: ['workspace', 'functions', 'invoke'],
    arguments: '<function_id> <operation>',
    summary:
        "Call one operation of a Function you can invoke, through Dexto's authenticated proxy, with its arguments as a JSON object.",
    options: {
        ...BODY_OPTIONS,
        deployment: {
            type: 'string',
            valueName: 'ID',
            description: 'Invoke this deployment of a Function you own instead of production.',
        },
        timeout: {
            type: 'string',
            valueName: 'MS',
            description: 'Milliseconds to wait for the Function (100-30000, default 10000).',
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const projectId = argument(input, 0, 'function_id');
        const operation = argument(input, 1, 'operation');
        const body = await readJsonBody(context, input);
        if (body !== null && !isJsonObject(body))
            throw new UsageError("A Function's arguments must be a JSON object.");
        const deploymentId = stringOption(input, 'deployment');
        const timeoutMs = boundedOption(input, 'timeout', 100, 30_000);
        await requireLoginScopes(context, ['functions:invoke']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Invoke ${operation} on Function ${projectId}? It runs as you and may change things.`
        );
        const result = parsed(
            InvocationSchema,
            await queryWorkspaceTool(context, 'dexto_function_invoke', {
                projectId,
                operation,
                ...(body === null ? {} : { arguments: body }),
                ...(deploymentId === undefined ? {} : { deploymentId }),
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
            }),
            'Function invocation'
        );
        if (result.kind === 'error')
            throw new CommandFailure(
                INVOCATION_FAILURES[result.error.code] ?? 'failed',
                result.error.message,
                null
            );
        context.output.result(
            result,
            result.body.kind === 'text'
                ? result.body.value
                : JSON.stringify(result.body.value, null, 2)
        );
    },
};

export const workspaceFunctionCommands: readonly Command[] = [list, get, invoke];
