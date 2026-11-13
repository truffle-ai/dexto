// `projects`: your Dexto Projects, their coordinators and their chats, over the Dexto MCP.
// Cloud build projects are a different thing and live under `cloud projects`.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    choiceOption,
    flag,
    integerOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const PROJECT_ARGUMENT = '<project>';
const START_POLICIES = ['start', 'propose'] as const;
const CHAT_DISPOSITIONS = ['keep', 'delete'] as const;
const IMPORTED_FROM = ['claude_code', 'codex', 'any'] as const;

const ProjectSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        coordinator: z
            .object({
                conversationSessionId: z.string().nullable(),
                dailyChatCap: z.number().nullable(),
                startPolicy: z.string(),
            })
            .passthrough(),
        pinnedAt: z.string().nullable(),
        updatedAt: z.string(),
    })
    .passthrough();
const ProjectResultSchema = z.object({ project: ProjectSchema }).passthrough();

const ChatStartedSchema = z
    .object({
        session: z
            .object({
                id: z.string(),
                title: z.string().nullable().optional(),
                url: z.string(),
                status: z.string(),
            })
            .passthrough(),
    })
    .passthrough();
const ChatDeclinedSchema = z
    .object({
        status: z.enum(['proposed', 'cap_reached']),
        nextAction: z.string(),
    })
    .passthrough();

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

/**
 * The Project as the server reads it. An id alone names a chat to `dexto_chat_send`, so a
 * Project id becomes its page's link there; links pass through unchanged.
 */
async function projectLink(context: CommandContext, project: string): Promise<string> {
    if (/^https?:\/\//iu.test(project)) return project;
    const connection = await context.connection();
    if (connection.kind !== 'oauth')
        throw new UsageError('Pass the Project by its link when signed in with a key.');
    return new URL(
        `/desktop/apps/chat/projects/${encodeURIComponent(project)}`,
        connection.login.appUrl
    ).toString();
}

function projectLine(project: z.output<typeof ProjectSchema>): string {
    return `${project.name} (${project.id})`;
}

const list: Command = {
    path: ['projects', 'list'],
    summary: 'List your Projects, optionally only those matching words or imported from a tool.',
    options: {
        query: {
            type: 'string',
            valueName: 'TEXT',
            description: "Words that must all appear in a Project's name or description.",
        },
        'imported-from': {
            type: 'string',
            valueName: 'SOURCE',
            description: `Only Projects imported from ${IMPORTED_FROM.join(', ')}.`,
        },
    },
    async run(context, input) {
        const query = stringOption(input, 'query');
        const importedFrom = choiceOption(input, 'imported-from', IMPORTED_FROM);
        await requireLoginScopes(context, ['projects:read']);
        const result = parsed(
            z.object({ projects: z.array(ProjectSchema) }).passthrough(),
            await queryWorkspaceTool(context, 'dexto_projects_list', {
                ...(query === undefined ? {} : { query }),
                ...(importedFrom === undefined ? {} : { importedFrom }),
            }),
            'Project list'
        );
        context.output.list({ data: result.projects }, [
            { header: 'id', value: (project) => project.id },
            { header: 'name', value: (project) => project.name },
            { header: 'starts', value: (project) => project.coordinator.startPolicy },
            { header: 'pinned', value: (project) => (project.pinnedAt === null ? '' : 'yes') },
            { header: 'updated', value: (project) => project.updatedAt },
        ]);
    },
};

const get: Command = {
    path: ['projects', 'get'],
    arguments: PROJECT_ARGUMENT,
    summary: 'Show a Project, by id or link: its settings, coordinator and folder.',
    async run(context, input) {
        const project = argument(input, 0, 'project');
        await requireLoginScopes(context, ['projects:read']);
        context.output.record(
            parsed(
                ProjectResultSchema,
                await queryWorkspaceTool(context, 'dexto_project_get', { project }),
                'Project'
            )
        );
    },
};

const DESCRIPTION_OPTION = {
    description: { type: 'string', valueName: 'TEXT', description: 'What the Project is for.' },
} as const;

const create: Command = {
    path: ['projects', 'create'],
    arguments: '<name>',
    summary: 'Create a Project. Its coordinator starts once you send it a message.',
    options: {
        ...DESCRIPTION_OPTION,
        timezone: {
            type: 'string',
            valueName: 'ZONE',
            description: 'IANA time zone for its schedules, such as Europe/London.',
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const name = argument(input, 0, 'name');
        const description = stringOption(input, 'description');
        const timezone = stringOption(input, 'timezone');
        await requireLoginScopes(context, ['projects:write']);
        await requireConsent(context, flag(input, 'yes'), `Create the Project ${name}?`);
        const { project } = parsed(
            ProjectResultSchema,
            await queryWorkspaceTool(context, 'dexto_project_create', {
                name,
                ...(description === undefined ? {} : { description }),
                ...(timezone === undefined ? {} : { timezone }),
            }),
            'Project'
        );
        context.output.result(
            { project },
            `Created Project ${projectLine(project)}. Brief its coordinator with dexto projects run ${project.id} "<message>".`
        );
    },
};

/** The fields `projects update` changes; at least one is required. */
function updateFields(input: CommandInput): Record<string, unknown> {
    const name = stringOption(input, 'name');
    const description = stringOption(input, 'description');
    const startPolicy = choiceOption(input, 'start-policy', START_POLICIES);
    const dailyCap = integerOption(input, 'daily-cap');
    const quietDays = integerOption(input, 'quiet-days');
    if (dailyCap !== undefined && (dailyCap < 1 || dailyCap > 200))
        throw new UsageError('--daily-cap must be between 1 and 200.');
    if (quietDays !== undefined && (quietDays < 1 || quietDays > 90))
        throw new UsageError('--quiet-days must be between 1 and 90.');
    if (flag(input, 'pin') && flag(input, 'unpin'))
        throw new UsageError('Pass --pin or --unpin, not both.');
    const fields: Record<string, unknown> = {
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
        ...(flag(input, 'clear-description') ? { description: null } : {}),
        ...(startPolicy === undefined ? {} : { coordinatorStartPolicy: startPolicy }),
        ...(dailyCap === undefined ? {} : { coordinatorDailyChatCap: dailyCap }),
        ...(quietDays === undefined ? {} : { quietDays }),
        ...(flag(input, 'pin') ? { pinned: true } : {}),
        ...(flag(input, 'unpin') ? { pinned: false } : {}),
    };
    if (description !== undefined && flag(input, 'clear-description'))
        throw new UsageError('Pass --description or --clear-description, not both.');
    if (Object.keys(fields).length === 0)
        throw new UsageError('Pass at least one field to change.');
    return fields;
}

const update: Command = {
    path: ['projects', 'update'],
    arguments: PROJECT_ARGUMENT,
    summary: "Change a Project's name, description, pin, or how its coordinator starts chats.",
    options: {
        name: { type: 'string', valueName: 'NAME', description: 'A new name.' },
        ...DESCRIPTION_OPTION,
        'clear-description': { type: 'boolean', description: 'Remove the description.' },
        'start-policy': {
            type: 'string',
            valueName: 'POLICY',
            description:
                'start: the coordinator starts chats itself; propose: it suggests them for you to start.',
        },
        'daily-cap': {
            type: 'string',
            valueName: 'N',
            description: 'Most chats the coordinator may start in any 24 hours (1-200).',
        },
        'quiet-days': {
            type: 'string',
            valueName: 'N',
            description: 'Days without activity before a Project chat becomes Done (1-90).',
        },
        pin: { type: 'boolean', description: 'Pin the Project.' },
        unpin: { type: 'boolean', description: 'Unpin the Project.' },
        ...YES_OPTION,
    },
    async run(context, input) {
        const project = argument(input, 0, 'project');
        const fields = updateFields(input);
        await requireLoginScopes(context, ['projects:write']);
        await requireConsent(context, flag(input, 'yes'), `Change the Project ${project}?`);
        const result = parsed(
            ProjectResultSchema,
            await queryWorkspaceTool(context, 'dexto_project_update', { project, ...fields }),
            'Project'
        );
        context.output.result(result, `Updated Project ${projectLine(result.project)}.`);
    },
};

const remove: Command = {
    path: ['projects', 'delete'],
    arguments: PROJECT_ARGUMENT,
    summary: "Delete a Project, keeping its chats or deleting them with it. It can't be undone.",
    options: {
        chats: {
            type: 'string',
            valueName: 'WHAT',
            description:
                "keep: its chats move back to your chats; delete: they're deleted with it. Required.",
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const project = argument(input, 0, 'project');
        const chatDisposition = choiceOption(input, 'chats', CHAT_DISPOSITIONS);
        if (chatDisposition === undefined)
            throw new UsageError('--chats is required: keep or delete.');
        await requireLoginScopes(context, ['projects:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            chatDisposition === 'delete'
                ? `Deleting the Project ${project} and its chats can't be undone.`
                : `Deleting the Project ${project} can't be undone; its chats are kept.`
        );
        const result = parsed(
            ProjectResultSchema,
            await queryWorkspaceTool(context, 'dexto_project_delete', {
                project,
                chatDisposition,
            }),
            'deleted Project'
        );
        context.output.result(result, `Deleted Project ${projectLine(result.project)}.`);
    },
};

const move: Command = {
    path: ['projects', 'move'],
    arguments: '<chat> [project]',
    summary: 'Move a chat into a Project, or with --out take it out of its Project.',
    options: {
        out: { type: 'boolean', description: 'Take the chat out of its Project.' },
        ...YES_OPTION,
    },
    async run(context, input) {
        const chat = argument(input, 0, 'chat');
        const target = input.positionals[1];
        const out = flag(input, 'out');
        if (out === (target !== undefined))
            throw new UsageError('Name the Project to move the chat into, or pass --out.');
        await requireLoginScopes(context, ['projects:write', 'sessions:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            target === undefined
                ? `Take chat ${chat} out of its Project?`
                : `Move chat ${chat} into the Project ${target}, where its coordinator takes it on?`
        );
        const result = parsed(
            z
                .object({
                    chat: z
                        .object({ id: z.string(), project: z.string().nullable() })
                        .passthrough(),
                })
                .passthrough(),
            await queryWorkspaceTool(context, 'dexto_project_chat_move', {
                chat,
                project: target ?? null,
            }),
            'chat move result'
        );
        context.output.result(
            result,
            result.chat.project === null
                ? `Chat ${result.chat.id} is out of its Project.`
                : `Chat ${result.chat.id} is in Project ${result.chat.project}.`
        );
    },
};

const MODEL_OPTIONS = {
    model: { type: 'string', valueName: 'ID', description: 'Model from workspace chat models.' },
} as const;

const start: Command = {
    path: ['projects', 'start'],
    arguments: `${PROJECT_ARGUMENT} <brief>`,
    summary:
        "Start a chat in a Project with a brief it can act on alone. The Project's start policy and daily cap apply.",
    options: {
        title: { type: 'string', valueName: 'TEXT', description: 'Short chat title.' },
        ...MODEL_OPTIONS,
        route: {
            type: 'string',
            valueName: 'ROUTE',
            description: 'Payment route for the chosen model; needs --model.',
        },
        agent: {
            type: 'string',
            valueName: 'ID',
            description: 'Agent profile; omitted uses your Dexto.',
        },
        repository: {
            type: 'string',
            valueName: 'VALUE',
            description:
                'Repository context: owner/repository or an HTTPS URL. Does not connect or clone it.',
        },
        continues: {
            type: 'string',
            valueName: 'CHAT',
            description: 'A Done chat in this Project that the new chat continues.',
        },
    },
    async run(context, input) {
        const project = argument(input, 0, 'project');
        const message = argument(input, 1, 'brief');
        const args: Record<string, string> = { project, message };
        for (const [option, field] of Object.entries({
            title: 'title',
            model: 'model',
            route: 'route',
            agent: 'agentId',
            repository: 'repository',
            continues: 'continuesSessionId',
        })) {
            const value = stringOption(input, option);
            if (value !== undefined) args[field] = value;
        }
        if (args.route !== undefined && args.model === undefined)
            throw new UsageError('--route needs --model.');
        await requireLoginScopes(context, ['sessions:write']);
        const raw = await queryWorkspaceTool(context, 'dexto_project_chat_start', args);
        const declined = ChatDeclinedSchema.safeParse(raw);
        if (declined.success) {
            // Nothing started: a person starts the proposed chat from its card in the Project.
            if (context.output.json) context.output.result(raw, '');
            throw new CommandFailure(
                'waiting_on_person',
                declined.data.status === 'proposed'
                    ? 'This Project proposes chats first. A person starts it from its card in the Project.'
                    : 'This Project started its most chats for today. A person can still start this one from its card.',
                null
            );
        }
        const result = parsed(ChatStartedSchema, raw, 'chat start result');
        context.output.result(
            result,
            `Started ${result.session.title ?? result.session.id}\n${result.session.url}\nStatus: ${result.session.status}`
        );
    },
};

const run: Command = {
    path: ['projects', 'run'],
    arguments: `${PROJECT_ARGUMENT} <message>`,
    summary:
        "Message a Project's coordinator, opening it if needed. It steers the coordinator's current turn unless --follow-up.",
    options: {
        'follow-up': {
            type: 'boolean',
            description: 'Wait until the current work ends instead of steering it.',
        },
        ...MODEL_OPTIONS,
        ...YES_OPTION,
    },
    async run(context, input) {
        const project = argument(input, 0, 'project');
        const message = argument(input, 1, 'message');
        const model = stringOption(input, 'model');
        await requireLoginScopes(context, ['sessions:write']);
        const sessionId = await projectLink(context, project);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Send this message to the coordinator of the Project ${project}?`
        );
        const result = await queryWorkspaceTool(context, 'dexto_chat_send', {
            sessionId,
            message,
            queue: flag(input, 'follow-up') ? 'follow-up' : 'steer',
            ...(model === undefined ? {} : { model }),
        });
        context.output.result(result, `Sent to the coordinator of the Project ${project}.`);
    },
};

export const chatProjectCommands: readonly Command[] = [
    list,
    get,
    create,
    update,
    remove,
    move,
    start,
    run,
];
