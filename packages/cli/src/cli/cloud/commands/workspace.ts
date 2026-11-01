// `workspace`: the tools an agent uses in your Dexto workspace over MCP, called as you.

import { z } from 'zod';

import {
    argument,
    BODY_OPTIONS,
    CommandFailure,
    flag,
    isJsonObject,
    MissingScopeFailure,
    readJsonBody,
    requireConsent,
    rerunWith,
    signInCommand,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';

const ToolSchema = z.object({
    /** `dexto/app`, `dexto/app_kind` and `dexto/level` say which app provides the tool and how it asks. */
    _meta: z.record(z.string(), z.unknown()).optional(),
    description: z.string().optional(),
    inputSchema: z.unknown(),
    name: z.string(),
    title: z.string().optional(),
});

export type WorkspaceTool = z.output<typeof ToolSchema>;

const ToolListSchema = z.object({ tools: z.array(ToolSchema) });

/** The levels at which a call asks the person before it runs. */
export const ASKING_LEVELS: ReadonlySet<string> = new Set(['act', 'approve', 'money']);

/** A tool's level for one call: its action's own level, where the action decides it. */
export function toolCallLevel(tool: WorkspaceTool, input: Record<string, unknown>): string {
    const levels = tool._meta?.['dexto/action_levels'];
    const actionLevel =
        isJsonObject(levels) && typeof input.action === 'string' ? levels[input.action] : undefined;
    if (typeof actionLevel === 'string') return actionLevel;
    const level = tool._meta?.['dexto/level'];
    return typeof level === 'string' ? level : 'act';
}

/**
 * Agrees to a call that asks first, by `--yes` or at the terminal, and returns what to add to its
 * input: `confirm: true` where the tool takes it, the server's sign that the person agreed.
 */
export async function agreeToCall(
    context: CommandContext,
    call: { readonly level: string; readonly schema: unknown; readonly title: string },
    yes: boolean
): Promise<{ confirm?: true }> {
    if (!ASKING_LEVELS.has(call.level)) return {};
    await requireConsent(
        context,
        yes,
        `"${call.title}" asks before it runs (level ${call.level}).`
    );
    return takesConfirm(call.schema) ? { confirm: true } : {};
}

function takesConfirm(schema: unknown): boolean {
    if (!isJsonObject(schema)) return false;
    const variants = [
        schema,
        ...[schema.anyOf, schema.oneOf].flatMap((each) => (Array.isArray(each) ? each : [])),
    ];
    return variants.some(
        (variant) =>
            isJsonObject(variant) &&
            isJsonObject(variant.properties) &&
            'confirm' in variant.properties
    );
}

/** Every workspace tool the sign-in can call, as the Dexto MCP lists them. */
export async function listWorkspaceTools(context: CommandContext): Promise<WorkspaceTool[]> {
    return ToolListSchema.parse(await callMcp(context, 'tools/list', {})).tools;
}

const ToolResultSchema = z.object({
    content: z
        .array(z.object({ text: z.string().optional(), type: z.string() }).passthrough())
        .default([]),
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
});

const tools: Command = {
    options: {
        search: {
            description: 'Only tools whose name or description has this text.',
            type: 'string',
        },
    },
    path: ['workspace', 'tools'],
    summary: 'List the workspace tools your sign-in can call.',
    async run(context, input) {
        const search = stringOption(input, 'search')?.toLowerCase();
        const listed = (await listWorkspaceTools(context)).filter(
            (tool) =>
                search === undefined ||
                tool.name.toLowerCase().includes(search) ||
                (tool.description ?? '').toLowerCase().includes(search)
        );
        context.output.list({ data: listed }, [
            { header: 'name', value: (tool) => tool.name },
            {
                header: 'title',
                value: (tool) => tool.title ?? tool.description ?? '',
            },
        ]);
    },
};

const describe: Command = {
    arguments: '<tool>',
    path: ['workspace', 'describe'],
    summary: "Show a workspace tool's description and the input it takes.",
    async run(context, input) {
        const name = argument(input, 0, 'tool');
        const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
        if (tool === undefined)
            throw new UsageError(
                `No workspace tool ${name}. List them with dexto workspace tools.`
            );
        if (context.output.json) return context.output.record(tool);
        context.runtime.writeOutput(
            `${tool.title ?? tool.name}\n\n${tool.description ?? ''}\n\nInput:\n${JSON.stringify(tool.inputSchema, null, 2)}\n`
        );
    },
};

const call: Command = {
    arguments: '<tool>',
    options: { ...BODY_OPTIONS, ...YES_OPTION },
    path: ['workspace', 'call'],
    summary:
        'Call a workspace tool with its input as JSON, such as: dexto workspace call dexto_search --data \'{"query":"invoices"}\'',
    async run(context, input) {
        const body = await readJsonBody(context, input);
        if (body !== null && !isJsonObject(body))
            throw new UsageError("A tool's input must be a JSON object.");
        const name = argument(input, 0, 'tool');
        const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
        // A tool the sign-in isn't listed can't run anyway: the server refuses it and says why.
        const agreed =
            tool === undefined
                ? {}
                : await agreeToCall(
                      context,
                      {
                          level: toolCallLevel(tool, body ?? {}),
                          schema: tool.inputSchema,
                          title: tool.title ?? tool.name,
                      },
                      flag(input, 'yes')
                  );
        return await callWorkspaceTool(context, name, { ...body, ...agreed });
    },
};

/** Calls a workspace tool and prints its result; a tool's own error fails the command. */
export async function callWorkspaceTool(
    context: CommandContext,
    name: string,
    input: unknown
): Promise<number> {
    const result = ToolResultSchema.parse(
        await callMcp(context, 'tools/call', { arguments: input, name })
    );
    if (result.isError === true) throw toolFailure(context, result);
    if (context.output.json) context.output.record(toolValue(result));
    else {
        const text = result.content
            .map((part) => part.text)
            .filter((part): part is string => part !== undefined);
        context.runtime.writeOutput(
            text.length > 0
                ? `${text.join('\n')}\n`
                : `${JSON.stringify(result.structuredContent ?? result.content, null, 2)}\n`
        );
    }
    return 0;
}

/** A tool result's value: its structured content, else its text as JSON, else the text itself. */
function toolValue(result: z.output<typeof ToolResultSchema>): unknown {
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = result.content
        .map((part) => part.text)
        .filter((part): part is string => part !== undefined)
        .join('\n');
    try {
        return JSON.parse(text);
    } catch {
        return { text };
    }
}

/** A tool's own error as a failure: not found, a permission to grant, or a failed call. */
function toolFailure(
    context: CommandContext,
    result: z.output<typeof ToolResultSchema>
): CommandFailure {
    const value = toolValue(result);
    const error = isJsonObject(value) && isJsonObject(value.error) ? value.error : null;
    const status = isJsonObject(value) ? (value.status ?? error?.code) : undefined;
    const text = result.content
        .map((part) => part.text)
        .filter((part): part is string => part !== undefined)
        .join('\n');
    const message =
        (isJsonObject(value) && typeof value.message === 'string' && value.message) ||
        (typeof error?.message === 'string' && error.message) ||
        text ||
        'The tool reported an error.';
    if (status === 'not_found') return new CommandFailure('not_found', message, null);
    const scopes =
        isJsonObject(value) && Array.isArray(value.requiredScopes) ? value.requiredScopes : [];
    if (status === 'consent_required' && scopes.length > 0)
        return new MissingScopeFailure(context, scopes.map(String).join(','), message);
    return new CommandFailure('failed', message, null);
}

/** Calls a workspace tool for its value, without printing it; the tool's own error fails. */
export async function queryWorkspaceTool(
    context: CommandContext,
    name: string,
    input: unknown
): Promise<unknown> {
    const result = ToolResultSchema.parse(
        await callMcp(context, 'tools/call', { arguments: input, name })
    );
    if (result.isError === true) throw toolFailure(context, result);
    return toolValue(result);
}

/** Calls a workspace tool for its structured result, without printing it. */
export async function readWorkspaceTool(
    context: CommandContext,
    name: string,
    input: unknown
): Promise<unknown> {
    const result = ToolResultSchema.parse(
        await callMcp(context, 'tools/call', { arguments: input, name })
    );
    if (result.isError === true) return null;
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = result.content.find((part) => part.text !== undefined)?.text;
    if (text === undefined) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

let nextRequestId = 1;

/**
 * One JSON-RPC request to the Dexto MCP with the person's token. It takes only a person's sign-in:
 * the workspace acts as a person, never as a project key.
 */
async function callMcp(context: CommandContext, method: string, params: unknown): Promise<unknown> {
    const connection = await context.connection();
    if (connection.kind !== 'oauth')
        throw new CommandFailure(
            'needs_sign_in',
            "Workspace tools act as you, so an API key can't use them. Sign in as yourself.",
            signInCommand(context, null)
        );
    const response = await context.runtime.fetch(connection.login.resource, {
        body: JSON.stringify({
            id: nextRequestId++,
            jsonrpc: '2.0',
            method,
            params,
        }),
        headers: {
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${connection.token}`,
            'content-type': 'application/json',
        },
        method: 'POST',
        signal: context.runtime.signal,
    });
    if (response.status === 401 || response.status === 403)
        throw new CommandFailure(
            'needs_sign_in',
            "Your sign-in can't reach the workspace. Sign in again to grant it.",
            signInCommand(context, null)
        );
    const text = await response.text();
    if (!response.ok) throw new Error(`The Dexto MCP answered HTTP ${response.status}.`);
    const message = parseJsonRpc(
        response.headers.get('content-type')?.includes('text/event-stream') === true
            ? lastEventData(text)
            : text
    );
    if (message.error !== undefined) throw refusalFailure(context, message.error);
    return message.result;
}

/**
 * A refusal as a failure, by the kind, scope and level its `data` names. Servers that send no
 * `data` say it only in the message, so that is read too.
 */
function refusalFailure(
    context: CommandContext,
    error: NonNullable<z.output<typeof JsonRpcResponseSchema>['error']>
): CommandFailure {
    const data = RefusalDataSchema.safeParse(error.data).data ?? {};
    // `scopes` when any one of several would do: asking for the first is enough.
    const scope = data.scope ?? data.scopes?.[0] ?? MISSING_SCOPE.exec(error.message)?.[1];
    if (scope !== undefined)
        return new MissingScopeFailure(
            context,
            scope,
            data.scopes !== undefined && data.scopes.length > 1
                ? `This needs one of the ${data.scopes.join(', ')} permissions, which your sign-in doesn't have.`
                : `This needs the ${scope} permission, which your sign-in doesn't have.`
        );
    if (data.kind === 'needs_confirmation')
        return new CommandFailure('needs_confirmation', error.message, rerunWith(context, '--yes'));
    if (
        data.kind === 'not_found' ||
        (data.kind === undefined && /\bnot found\b/iu.test(error.message))
    )
        return new CommandFailure('not_found', error.message, null);
    if (data.kind === 'forbidden' || (data.kind === undefined && error.code === -32003))
        return new CommandFailure('needs_permission', error.message, null);
    if (
        data.kind === 'invalid_arguments' ||
        data.kind === 'unprocessable' ||
        (data.kind === undefined && error.code === -32602)
    )
        return new CommandFailure('invalid_input', error.message, null);
    return new CommandFailure('failed', error.message, null);
}

/** How the Dexto MCP refuses a tool the token's grant doesn't cover. */
const MISSING_SCOPE = /missing required scope: ([\w:.-]+?)\.?$/u;

const RefusalDataSchema = z.object({
    kind: z.string().optional(),
    level: z.string().optional(),
    scope: z.string().optional(),
    scopes: z.array(z.string()).optional(),
});

const JsonRpcResponseSchema = z.object({
    error: z
        .object({ code: z.number(), data: z.unknown().optional(), message: z.string() })
        .optional(),
    result: z.unknown().optional(),
});

function parseJsonRpc(text: string): z.output<typeof JsonRpcResponseSchema> {
    return JsonRpcResponseSchema.parse(JSON.parse(text));
}

function lastEventData(stream: string): string {
    const data = stream
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
    const last = data.at(-1);
    if (last === undefined) throw new Error('The Dexto MCP sent no reply.');
    return last;
}

export const workspaceCommands: readonly Command[] = [tools, describe, call];
