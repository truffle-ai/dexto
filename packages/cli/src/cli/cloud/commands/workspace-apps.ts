// `workspace <app> <operation>`: the workspace's operations grouped by the app that provides them.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
    isJsonObject,
    MissingScopeFailure,
    shellWord,
    UsageError,
    type CommandContext,
} from '../command.js';
import { readAppScopes } from '../app-scopes.js';
import { attachFiles, fileFieldOf, isLocalFile, type FileField } from './app-files.js';
import {
    agreeToCall,
    ASKING_LEVELS,
    callWorkspaceTool,
    listWorkspaceTools,
    readWorkspaceTool,
    type WorkspaceTool,
} from './workspace.js';

/** One app or service: how many of its tools the sign-in reaches, and how many App actions it has. */
export interface WorkspaceApp {
    readonly actions: number;
    readonly id: string;
    readonly kind: string;
    readonly tools: number;
}

/**
 * One thing an app does: a workspace tool, one action of a tool that is the whole app (such as
 * `dexto_drive`), or an App action run through `dexto_apps_action`.
 */
export interface Operation {
    readonly call:
        | { readonly kind: 'action'; readonly toolName: string }
        | {
              readonly action: string | null;
              /** Each action's own level, where a tool's actions differ (`dexto/action_levels`). */
              readonly actionLevels: Readonly<Record<string, string>>;
              readonly kind: 'tool';
              readonly name: string;
          };
    /** The schema whose `confirm` field says the person agreed: the tool's, or `dexto_apps_action`'s. */
    readonly confirmSchema: unknown;
    readonly description: string;
    readonly inputSchema: unknown;
    readonly level: string;
    readonly name: string;
    readonly title: string;
}

/**
 * The apps the sign-in reaches: those whose manifests provide its tools, and the Apps whose
 * actions it can run. Tools a server lists without a provider stay under `workspace call`.
 */
export async function listWorkspaceApps(context: CommandContext): Promise<WorkspaceApp[]> {
    const tools = await listWorkspaceTools(context);
    const apps = new Map<string, WorkspaceApp>();
    for (const tool of tools) {
        const provider = providerOf(tool);
        if (provider === null) continue;
        const app = apps.get(provider.id) ?? { ...provider, actions: 0, tools: 0 };
        apps.set(provider.id, { ...app, tools: app.tools + 1 });
    }
    for (const listed of await listActionApps(context, tools)) {
        const app = apps.get(listed.id) ?? {
            actions: 0,
            id: listed.id,
            kind: 'app',
            tools: 0,
        };
        apps.set(listed.id, { ...app, actions: listed.actions });
    }
    return [...apps.values()]
        .filter((app) => app.tools + app.actions > 0)
        .sort((left, right) => left.id.localeCompare(right.id));
}

/** A command the CLI itself adds to an app, such as `drive put`, listed with the app's operations. */
export interface AppCommand {
    /** Its words after the app's, such as `put`. */
    readonly name: string;
    readonly summary: string;
    readonly usage: string;
}

/** Runs `<app> [operation] [action] [--field value…]`; `commands` are the CLI's own for the app. */
export async function runWorkspaceApp(
    context: CommandContext,
    args: readonly string[],
    help: boolean,
    commands: readonly AppCommand[]
): Promise<number> {
    const [appId, operationName, ...rest] = args;
    if (appId === undefined) throw new UsageError('Name an app, such as dexto workspace drive.');
    const operations = await appOperations(context, await listWorkspaceTools(context), appId);
    if (operations.length === 0 && commands.length === 0) {
        await requireOperationScopes(context, appId, operationName);
        throw new UsageError(
            `Unknown command or app: ${appId}. List your workspace's apps with dexto workspace.`
        );
    }
    if (operationName === undefined || operationName.startsWith('-')) {
        printOperations(context, appId, operations, commands);
        return 0;
    }
    const operation = operations.find((each) => each.name === operationName);
    if (operation === undefined) {
        await requireOperationScopes(context, appId, operationName);
        throw new UsageError(
            `${appId} has no operation ${operationName}. Its operations: ${[...operations, ...commands].map((each) => each.name).join(', ')}.`
        );
    }
    if (help) {
        printOperationHelp(context, appId, operation);
        return 0;
    }
    // An App action's dispatcher refuses one scope at a time, so ask for all it takes up front.
    if (operation.call.kind === 'action')
        await requireOperationScopes(context, appId, operationName);
    const {
        attachFiles: attach,
        input,
        yes,
    } = await operationInput(context, operation, rest, appId);
    const agreed = await agreeToCall(
        context,
        {
            level: callLevel(operation, input),
            schema: operation.confirmSchema,
            title: operation.title,
        },
        yes
    );
    // Local files are uploaded only once the person has agreed, so declining leaves none behind.
    await attach();
    return operation.call.kind === 'tool'
        ? await callWorkspaceTool(context, operation.call.name, {
              ...input,
              ...(operation.call.action === null ? {} : { action: operation.call.action }),
              ...agreed,
          })
        : await callWorkspaceTool(context, 'dexto_apps_action', {
              appId,
              arguments: input,
              toolName: operation.call.toolName,
              ...agreed,
          });
}

/**
 * A sign-in sees only the operations its scopes allow, so one it can't see may need more: refuses
 * with the scopes the named operation takes that the sign-in lacks, or, with none named, those of
 * the app's operations. The server leaves out any that can spend, and a name no operation has
 * asks for nothing.
 */
async function requireOperationScopes(
    context: CommandContext,
    appId: string,
    operationName: string | undefined
): Promise<void> {
    const connection = await context.connection();
    if (connection.kind !== 'oauth') return;
    const operations = Object.entries(
        (await readAppScopes(context.runtime, connection.login.appUrl)).get(appId) ?? {}
    );
    const needed =
        operationName === undefined
            ? operations.flatMap(([, scopes]) => scopes)
            : (operations.find(
                  ([name]) =>
                      toolOperationName(name, appId) === operationName ||
                      actionOperationName(name, appId) === operationName
              )?.[1] ?? []);
    const missing = [...new Set(needed)].filter(
        (scope) => !connection.login.scopes.includes(scope)
    );
    if (missing.length > 0)
        throw new MissingScopeFailure(
            context,
            missing.join(','),
            `Your sign-in can't use ${operationName === undefined ? appId : `${appId} ${operationName}`} yet: it needs ${missing.join(', ')}.`
        );
}

/** Refuses at once when an OAuth sign-in lacks any of `scopes`, naming the sign-in that has them. */
async function requireScopes(
    context: CommandContext,
    scopes: readonly string[],
    what: string
): Promise<void> {
    const connection = await context.connection();
    if (connection.kind !== 'oauth') return;
    const missing = scopes.filter((scope) => !connection.login.scopes.includes(scope));
    if (missing.length > 0)
        throw new MissingScopeFailure(
            context,
            missing.join(','),
            `Your sign-in can't ${what} yet: it needs ${missing.join(', ')}.`
        );
}

/** An app's tools and its headless App actions, each under a short name unique in the app. */
async function appOperations(
    context: CommandContext,
    tools: readonly WorkspaceTool[],
    appId: string
): Promise<Operation[]> {
    const fromTools = tools
        .filter((tool) => providerOf(tool)?.id === appId)
        .flatMap((tool): Operation[] => {
            const actionLevels = actionLevelsOf(tool);
            const operation: Operation = {
                call: { action: null, actionLevels, kind: 'tool', name: tool.name },
                confirmSchema: tool.inputSchema,
                description: tool.description ?? '',
                inputSchema: tool.inputSchema,
                level: levelOf(tool),
                name: toolOperationName(tool.name, appId),
                title: tool.title ?? tool.name,
            };
            const actions = actionValues(tool.inputSchema);
            // `drive list-items`, not `drive drive list-items`.
            if (
                !appPrefixes(appId).includes(tool.name.replace(/^dexto_/u, '')) ||
                actions.length === 0
            )
                return [operation];
            return actions.map((action) => {
                return {
                    ...operation,
                    call: { action, actionLevels, kind: 'tool', name: tool.name },
                    inputSchema: actionVariant(tool.inputSchema, action),
                    level: actionLevels[action] ?? operation.level,
                    name: kebab(action),
                    title: `${operation.title}: ${kebab(action).replaceAll('-', ' ')}`,
                };
            });
        });
    const runsActions = tools.find((tool) => tool.name === 'dexto_apps_action');
    const fromActions = (await appActions(context, tools, appId)).map(
        (action): Operation => ({
            call: { kind: 'action', toolName: action.toolName },
            confirmSchema: runsActions?.inputSchema ?? null,
            description: action.description,
            inputSchema: action.inputSchema,
            level: action.level,
            name: actionOperationName(action.toolName, appId),
            title: action.title,
        })
    );
    return uniqueNames([...fromTools, ...fromActions]);
}

/** A Dexto tool and the arguments to call it with, as search names a route's call. */
export interface ToolCall {
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly tool: string;
}

/**
 * The CLI command that makes a call: `dexto workspace <app> <operation> --field value`, or
 * `workspace call` when no app operation does. A value written `<type>` is left for the caller to
 * fill in. `operationsByApp` keeps each app's operations across calls.
 */
export async function commandForCall(
    context: CommandContext,
    tools: readonly WorkspaceTool[],
    call: ToolCall,
    operationsByApp: Map<string, Operation[]>
): Promise<string> {
    const operationsOf = async (appId: string) => {
        const known = operationsByApp.get(appId);
        if (known !== undefined) return known;
        const listed = await appOperations(context, tools, appId);
        operationsByApp.set(appId, listed);
        return listed;
    };
    const words = await (async (): Promise<string[] | null> => {
        if (call.tool === 'dexto_apps_action') {
            const { appId, toolName } = call.arguments;
            if (typeof appId !== 'string' || typeof toolName !== 'string') return null;
            const operation = (await operationsOf(appId)).find(
                (each) => each.call.kind === 'action' && each.call.toolName === toolName
            );
            const input = isJsonObject(call.arguments.arguments) ? call.arguments.arguments : {};
            return operation === undefined ? null : [appId, operation.name, ...flagWords(input)];
        }
        const tool = tools.find((each) => each.name === call.tool);
        const appId = tool === undefined ? null : (providerOf(tool)?.id ?? null);
        if (appId === null) return null;
        const action = typeof call.arguments.action === 'string' ? call.arguments.action : null;
        const operation = (await operationsOf(appId)).find(
            (each) =>
                each.call.kind === 'tool' &&
                each.call.name === call.tool &&
                (each.call.action === null || each.call.action === action)
        );
        if (operation === undefined || operation.call.kind !== 'tool') return null;
        const input = Object.fromEntries(
            Object.entries(call.arguments).filter(([name]) => name !== 'action' || action === null)
        );
        return [
            appId,
            operation.name,
            ...(operation.call.action === null && action !== null ? [kebab(action)] : []),
            ...flagWords(input),
        ];
    })();
    return words === null
        ? ['dexto', 'workspace', 'call', call.tool, '--data', JSON.stringify(call.arguments)]
              .map(shellWord)
              .join(' ')
        : ['dexto', 'workspace', ...words].map(commandWord).join(' ');
}

/** Each input field as `--field value`; objects and lists as JSON. */
function flagWords(input: Readonly<Record<string, unknown>>): string[] {
    return Object.entries(input).flatMap(([name, value]) => [
        `--${kebab(name)}`,
        typeof value === 'string' ? value : JSON.stringify(value),
    ]);
}

/** A placeholder such as `<string>` stays readable; any other word is quoted as a shell needs. */
function commandWord(word: string): string {
    return /^<[\w ?|:-]+>$/u.test(word) ? word : shellWord(word);
}

/**
 * Keeps names unique in an app. Tools keep their short names, falling back to their full names
 * when two tools clash; an App action whose name is taken becomes `app-<name>`. Anything still
 * clashing is numbered.
 */
function uniqueNames(operations: readonly Operation[]): Operation[] {
    const named = (name: string, kind?: Operation['call']['kind']) =>
        operations.filter(
            (each) => each.name === name && (kind === undefined || each.call.kind === kind)
        ).length;
    const renamed = operations.map((operation): Operation => {
        if (operation.call.kind === 'action')
            return named(operation.name) > 1
                ? { ...operation, name: `app-${operation.name}` }
                : operation;
        if (named(operation.name, 'tool') === 1) return operation;
        const full = [operation.call.name.replace(/^dexto_/u, ''), operation.call.action];
        return { ...operation, name: kebab(full.filter((part) => part !== null).join('_')) };
    });
    const seen = new Map<string, number>();
    return renamed.map((operation) => {
        const count = (seen.get(operation.name) ?? 0) + 1;
        seen.set(operation.name, count);
        return count === 1 ? operation : { ...operation, name: `${operation.name}-${count}` };
    });
}

/** `dexto_chat_start` in `chat` is `start`; `dexto_gpu_sandboxes_list` in `gpus` is `sandboxes-list`. */
function toolOperationName(tool: string, appId: string): string {
    const bare = tool.replace(/^dexto_/u, '');
    for (const prefix of appPrefixes(appId)) {
        if (bare.startsWith(`${prefix}_`)) return kebab(bare.slice(prefix.length + 1));
    }
    return kebab(bare);
}

/** How tool names start for an app: `capabilities`, `capability`; `gpus`, `gpu`. */
function appPrefixes(appId: string): string[] {
    const name = appId.replaceAll('-', '_');
    return [name, name.replace(/ies$/u, 'y'), name.replace(/s$/u, '')];
}

/** `drive.listItems` in `drive` is `list-items`. */
function actionOperationName(toolName: string, appId: string): string {
    return kebab(toolName.startsWith(`${appId}.`) ? toolName.slice(appId.length + 1) : toolName);
}

function kebab(value: string): string {
    return value
        .replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2')
        .replaceAll(/[_.\s]+/gu, '-')
        .toLowerCase();
}

function providerOf(tool: WorkspaceTool): { id: string; kind: string } | null {
    const id = tool._meta?.['dexto/app'];
    const kind = tool._meta?.['dexto/app_kind'];
    return typeof id === 'string' ? { id, kind: typeof kind === 'string' ? kind : 'app' } : null;
}

function levelOf(tool: WorkspaceTool): string {
    const level = tool._meta?.['dexto/level'];
    return typeof level === 'string' ? level : 'act';
}

function actionLevelsOf(tool: WorkspaceTool): Record<string, string> {
    const levels = tool._meta?.['dexto/action_levels'];
    if (!isJsonObject(levels)) return {};
    return Object.fromEntries(
        Object.entries(levels).flatMap(([action, level]) =>
            typeof level === 'string' ? [[action, level]] : []
        )
    );
}

/** A call's level: its action's own, as `chat computer read` reads, else the operation's. */
function callLevel(operation: Operation, input: Readonly<Record<string, unknown>>): string {
    if (operation.call.kind !== 'tool' || typeof input.action !== 'string') return operation.level;
    return operation.call.actionLevels[input.action] ?? operation.level;
}

interface AppAction {
    readonly description: string;
    readonly inputSchema: unknown;
    readonly level: string;
    readonly title: string;
    readonly toolName: string;
}

/** The Apps this sign-in can see, and how many actions each declares, headless or not. */
async function listActionApps(
    context: CommandContext,
    tools: readonly WorkspaceTool[]
): Promise<{ actions: number; id: string }[]> {
    if (!tools.some((tool) => tool.name === 'dexto_apps_list')) return [];
    const listed = await readWorkspaceTool(context, 'dexto_apps_list', {});
    if (!isJsonObject(listed) || !Array.isArray(listed.apps)) return [];
    return listed.apps.flatMap((app) =>
        isJsonObject(app) && typeof app.id === 'string' && Array.isArray(app.actionsAvailable)
            ? [{ actions: app.actionsAvailable.length, id: app.id }]
            : []
    );
}

/** One App's actions that run without a live UI, from `dexto_app_get`. */
async function appActions(
    context: CommandContext,
    tools: readonly WorkspaceTool[],
    appId: string
): Promise<AppAction[]> {
    if (!tools.some((tool) => tool.name === 'dexto_app_get')) return [];
    const app = await readWorkspaceTool(context, 'dexto_app_get', { appId });
    if (!isJsonObject(app) || !Array.isArray(app.actions)) return [];
    return app.actions.flatMap((action): AppAction[] =>
        isJsonObject(action) &&
        typeof action.toolName === 'string' &&
        action.execution === 'headless'
            ? [
                  {
                      description: typeof action.description === 'string' ? action.description : '',
                      inputSchema: action.inputSchema,
                      level: typeof action.level === 'string' ? action.level : 'act',
                      title: typeof action.title === 'string' ? action.title : action.toolName,
                      toolName: action.toolName,
                  },
              ]
            : []
    );
}

/** The app's operations, then the CLI's own commands for it; as JSON, `commands` beside `data`. */
function printOperations(
    context: CommandContext,
    appId: string,
    operations: readonly Operation[],
    commands: readonly AppCommand[]
) {
    if (context.output.json) return context.output.record({ commands, data: operations });
    if (operations.length > 0) printOperationTable(context, appId, operations);
    if (commands.length === 0) return;
    const width = Math.max(...commands.map((command) => command.usage.length));
    context.runtime.writeOutput(
        `${operations.length > 0 ? '\n' : ''}Commands:\n${commands
            .map((command) => `  ${command.usage.padEnd(width)}  ${command.summary}`)
            .join('\n')}\n`
    );
}

function printOperationTable(
    context: CommandContext,
    appId: string,
    operations: readonly Operation[]
) {
    context.output.list({ data: operations }, [
        { header: 'operation', value: (operation) => operation.name },
        { header: 'level', value: (operation) => operation.level },
        {
            header: 'asks',
            value: (operation) => (ASKING_LEVELS.has(operation.level) ? 'yes' : ''),
        },
        { header: 'title', value: (operation) => operation.title },
    ]);
    if (!context.output.json)
        context.output.note(
            `Run one with dexto workspace ${appId} <operation> --field value; --help on it shows its input.`
        );
}

function printOperationHelp(context: CommandContext, appId: string, operation: Operation) {
    if (context.output.json) return context.output.record(operation);
    const fields = schemaFields(operation.inputSchema);
    const actions = openActions(operation);
    const lines = [
        `Usage: dexto workspace ${appId} ${operation.name}${actions.length > 0 ? ' <action>' : ''} [--field value…] [--data JSON]${ASKING_LEVELS.has(operation.level) ? ' [--yes]' : ''}`,
        '',
        operation.title,
        ...(operation.description.length > 0 ? ['', operation.description] : []),
        '',
        `Level: ${operation.level}${ASKING_LEVELS.has(operation.level) ? ' (asks first: pass --yes once your person has agreed)' : ''}`,
        ...(actions.length > 0 ? ['', `Actions: ${actions.map(kebab).join(', ')}`] : []),
        ...(fields.length > 0
            ? [
                  '',
                  'Input:',
                  ...fields.map(
                      (field) =>
                          `  --${kebab(field.name)}${REQUEST_ID_FIELDS.has(field.name) ? ' (made up when left out)' : field.required ? ' (required)' : ''}  ${field.file === null ? field.type : `file or link${field.file.list ? ', repeatable' : ''}`}${field.description.length > 0 ? `  ${field.description}` : ''}`
                  ),
                  '',
                  'Any field also reads a file, or stdin for -, as --<field>-file PATH.',
                  ...(fields.some((field) => field.file !== null)
                      ? [
                            'A file or link field takes a local path, which is uploaded into the app, or an https link.',
                        ]
                      : []),
              ]
            : []),
    ];
    context.runtime.writeOutput(`${lines.join('\n')}\n`);
}

interface SchemaField {
    readonly description: string;
    /** Where the field takes files an App keeps, which the CLI uploads from local paths. */
    readonly file: FileField | null;
    /** Whether it takes a list of strings, given comma-separated or by repeating the flag. */
    readonly list: boolean;
    readonly name: string;
    readonly required: boolean;
    readonly type: string;
}

/** The input object's fields, across the variants of a schema that offers several. */
function schemaFields(schema: unknown): SchemaField[] {
    const fields = new Map<string, SchemaField>();
    for (const variant of schemaVariants(schema)) {
        const required = new Set(
            Array.isArray(variant.required)
                ? variant.required.filter((each): each is string => typeof each === 'string')
                : []
        );
        const properties = isJsonObject(variant.properties) ? variant.properties : {};
        for (const [name, property] of Object.entries(properties)) {
            // A word picks `action`, and `--yes` sends `confirm`: neither is a field to type.
            if (fields.has(name) || name === 'action' || name === 'confirm') continue;
            fields.set(name, {
                description:
                    isJsonObject(property) && typeof property.description === 'string'
                        ? property.description
                        : '',
                file: isJsonObject(property) ? fileFieldOf(property) : null,
                list: isJsonObject(property) && takesStringList(property),
                name,
                required: required.has(name) && schemaVariants(schema).length === 1,
                type: isJsonObject(property) ? propertyType(property) : 'value',
            });
        }
    }
    return [...fields.values()];
}

/** Fields that only make a retry safe, which the CLI makes up when they're left out. */
const REQUEST_ID_FIELDS: ReadonlySet<string> = new Set([
    'idempotencyKey',
    'idempotency_key',
    'requestId',
    'request_id',
]);

/**
 * The required fields an input leaves out, by the schema that applies: the operation's own, or the
 * variant of the action picked. `action` and `confirm` are the CLI's to set.
 */
function missingFields(operation: Operation, input: Readonly<Record<string, unknown>>): string[] {
    const variants = schemaVariants(operation.inputSchema);
    const variant =
        variants.length === 1
            ? variants[0]
            : variants.find((each) => {
                  const action = isJsonObject(each.properties) ? each.properties.action : null;
                  return isJsonObject(action) && action.const === input.action;
              });
    const required = Array.isArray(variant?.required)
        ? variant.required.filter((each): each is string => typeof each === 'string')
        : [];
    return required.filter((name) => name !== 'action' && name !== 'confirm' && !(name in input));
}

function schemaVariants(schema: unknown): Record<string, unknown>[] {
    if (!isJsonObject(schema)) return [];
    const variants = Array.isArray(schema.anyOf)
        ? schema.anyOf
        : Array.isArray(schema.oneOf)
          ? schema.oneOf
          : [schema];
    // Variants beside the schema's own properties only narrow them: each one is all of them.
    const own = schema.properties;
    if (variants[0] === schema || !isJsonObject(own)) return variants.filter(isJsonObject);
    const required = Array.isArray(schema.required) ? schema.required : [];
    return variants.filter(isJsonObject).map((variant) => ({
        ...variant,
        properties: {
            ...own,
            ...(isJsonObject(variant.properties) ? variant.properties : {}),
        },
        required: [...required, ...(Array.isArray(variant.required) ? variant.required : [])],
    }));
}

/**
 * `string`, `folder|recent` for a choice, `string,…` for a list of strings, or `string or null` for
 * a field that takes either.
 */
function propertyType(property: Record<string, unknown>): string {
    if (Array.isArray(property.enum)) return property.enum.map(String).join('|');
    if (takesStringList(property) && !Array.isArray(property.anyOf)) return 'string,…';
    if (typeof property.const === 'string') return property.const;
    if (Array.isArray(property.anyOf))
        return property.anyOf
            .map((each) => (isJsonObject(each) ? propertyType(each) : 'value'))
            .join(' or ');
    return typeof property.type === 'string' ? property.type : 'value';
}

/** An array of strings, or a choice of types that includes one. */
function takesStringList(property: Record<string, unknown>): boolean {
    if (Array.isArray(property.anyOf))
        return property.anyOf.some((each) => isJsonObject(each) && takesStringList(each));
    return (
        property.type === 'array' &&
        isJsonObject(property.items) &&
        property.items.type === 'string'
    );
}

/** The actions left to pick: none where the operation is one action of its tool. */
function openActions(operation: Operation): string[] {
    return operation.call.kind === 'tool' && operation.call.action !== null
        ? []
        : actionValues(operation.inputSchema);
}

/** Whether the input takes fields its schema doesn't name; a closed object takes none. */
function takesOtherFields(schema: unknown): boolean {
    const variants = schemaVariants(schema);
    return (
        variants.length === 0 || variants.some((variant) => variant.additionalProperties !== false)
    );
}

/** The `action` values a tool that takes one action at a time accepts. */
function actionValues(schema: unknown): string[] {
    const values: string[] = [];
    for (const variant of schemaVariants(schema)) {
        const action = isJsonObject(variant.properties) ? variant.properties.action : undefined;
        if (!isJsonObject(action)) continue;
        if (typeof action.const === 'string') values.push(action.const);
        if (Array.isArray(action.enum))
            values.push(...action.enum.filter((each): each is string => typeof each === 'string'));
    }
    return [...new Set(values)];
}

/** The variant of a tool's schema that takes this action, or the whole schema when it has one. */
function actionVariant(schema: unknown, action: string): unknown {
    const variants = schemaVariants(schema);
    return (
        variants.find((variant) => {
            const property = isJsonObject(variant.properties) ? variant.properties.action : null;
            return isJsonObject(property) && property.const === action;
        }) ?? schema
    );
}

/**
 * The operation's input: `--data` or `--file` first, then each `--field value`, typed by the
 * field's schema. `--<field>-file <path|->` reads a field from a file or stdin, unless a field has
 * that whole name; a list of strings takes `a,b` or the flag repeated. A word after the operation
 * picks the action of a tool that takes one, and `--yes` agrees to an operation that asks first.
 */
async function operationInput(
    context: CommandContext,
    operation: Operation,
    args: readonly string[],
    appId: string
): Promise<{
    /** Uploads the local files the input names and puts their references in `input`. */
    attachFiles: () => Promise<void>;
    input: Record<string, unknown>;
    yes: boolean;
}> {
    const input: Record<string, unknown> = {};
    let yes = false;
    const fields = schemaFields(operation.inputSchema);
    const actions = openActions(operation);
    const lists = new Map<string, unknown[]>();
    const files = new Map<SchemaField, unknown[]>();
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index] ?? '';
        if (token === '--yes') {
            yes = true;
            continue;
        }
        if (!token.startsWith('--')) {
            const action = actions.find((each) => kebab(each) === kebab(token));
            if (action === undefined || 'action' in input)
                throw new UsageError(
                    actions.length === 0
                        ? `Unexpected ${token}. Give the input as --field value.`
                        : `Unknown action ${token}. Actions: ${actions.map(kebab).join(', ')}.`
                );
            input.action = action;
            continue;
        }
        const [flag, inline] = token.includes('=')
            ? [token.slice(2, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
            : [token.slice(2), null];
        const next = args[index + 1];
        const value = inline ?? (next !== undefined && !next.startsWith('--') ? next : null);
        if (inline === null && value !== null) index += 1;
        if (flag === 'data' || flag === 'file') {
            if (value === null) throw new UsageError(`--${flag} needs a value.`);
            const text = flag === 'file' ? await readText(context, value) : value;
            Object.assign(input, parseObject(text, `--${flag}`));
            continue;
        }
        const field = fields.find((each) => kebab(each.name) === kebab(flag)) ?? null;
        const fromFile =
            field === null && flag.endsWith('-file')
                ? (fields.find((each) => kebab(each.name) === kebab(flag.slice(0, -5))) ?? null)
                : null;
        if (fromFile !== null) {
            if (value === null) throw new UsageError(`--${flag} needs a path, or - for stdin.`);
            const text = await readText(context, value);
            // A string field takes the file's text as it is, a list its lines or commas, and any
            // other field reads it as JSON.
            input[fromFile.name] = fromFile.list
                ? listItems(text.trim(), flag)
                : fromFile.type.split(' or ').includes('string')
                  ? text
                  : typedValue(text, fromFile.type, flag);
            continue;
        }
        if (field === null && !takesOtherFields(operation.inputSchema))
            throw new UsageError(
                `${operation.name} takes no --${flag}. Its input: ${fields.map((each) => `--${kebab(each.name)}`).join(', ') || 'none'}.`
            );
        const name = field?.name ?? camel(flag);
        if (field !== null && field.file !== null && operation.call.kind === 'action') {
            if (value === null) throw new UsageError(`--${flag} needs a file's path or a link.`);
            // JSON gives the field's value as it is; a path or a link is one file.
            const given = /^[[{]/u.test(value) ? typedValue(value, 'array', flag) : value;
            files.set(field, [
                ...(files.get(field) ?? []),
                ...(Array.isArray(given) ? given : [given]),
            ]);
            continue;
        }
        if (value === null) input[name] = true;
        else if (field?.list === true) {
            const items = [...(lists.get(name) ?? []), ...listItems(value, flag)];
            lists.set(name, items);
            input[name] = items;
        } else input[name] = typedValue(value, field?.type ?? 'value', flag);
    }
    // Files are uploaded only once the rest of the input is complete.
    const named = {
        ...input,
        ...Object.fromEntries([...files.keys()].map((field) => [field.name, null])),
    };
    for (const name of missingFields(operation, named)) {
        if (!REQUEST_ID_FIELDS.has(name))
            throw new UsageError(
                `${operation.name} needs --${kebab(name)}. Add --help for its input.`
            );
        // A request id only makes a retry safe: one is made up, and said, so it can be reused.
        input[name] = randomUUID();
        context.output.note(
            `Using --${kebab(name)} ${String(input[name])}; pass the same one to retry without doing it twice.`
        );
    }
    for (const [field, values] of files) {
        if (field.file?.list === false && values.length > 1)
            throw new UsageError(`--${kebab(field.name)} takes one file.`);
    }
    // A local file is uploaded before the action runs: check the sign-in can do both first, so a
    // refusal leaves no upload behind.
    if ([...files].some(([field, values]) => field.file !== null && values.some(isLocalFile)))
        await requireScopes(context, ['drive:write', 'apps:execute'], `attach files to ${appId}`);
    const attach = async () => {
        for (const [field, values] of files) {
            if (field.file === null) continue;
            const attached = await attachFiles(context, appId, field.file, values);
            input[field.name] = field.file.list ? attached : attached[0];
        }
    };
    return { attachFiles: attach, input, yes };
}

/** A file's text, or stdin's for `-`. */
async function readText(context: CommandContext, path: string): Promise<string> {
    if (path === '-') return await context.runtime.readStdin();
    return await readFile(path, 'utf8').catch((error: unknown) => {
        throw new UsageError(
            `Can't read ${path}: ${error instanceof Error ? error.message : 'unknown error'}.`
        );
    });
}

/** A list's items: a JSON array as it is, otherwise the words between commas or lines. */
function listItems(value: string, flag: string): unknown[] {
    if (!value.startsWith('[')) return value.split(/[,\n]/u).flatMap((item) => item.trim() || []);
    const parsed = typedValue(value, 'array', flag);
    if (!Array.isArray(parsed)) throw new UsageError(`--${flag} isn't a JSON array.`);
    return parsed;
}

function parseObject(text: string, source: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new UsageError(`${source} isn't valid JSON.`);
    }
    if (!isJsonObject(parsed)) throw new UsageError(`${source} must be a JSON object.`);
    return parsed;
}

/** A flag's value as its field's type: a string field keeps the text; JSON for the rest. */
function typedValue(value: string, type: string, flag: string): unknown {
    const types = type.split(' or ');
    if (types.some((each) => each === 'string' || each.includes('|')))
        return value === 'null' && types.includes('null') ? null : value;
    try {
        return JSON.parse(value);
    } catch {
        if (/^[[{"]/u.test(value)) throw new UsageError(`--${flag} isn't valid JSON.`);
        return value;
    }
}

function camel(value: string): string {
    return value.replaceAll(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());
}
