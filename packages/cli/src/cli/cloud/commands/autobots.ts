// `autobots`: the AutoBots you can use, their status, and saving, publishing and talking to them,
// over Dexto's typed AutoBot tools.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent, rerunWith } from '../../interaction.js';
import {
    argument,
    BODY_OPTIONS,
    choiceOption,
    flag,
    integerOption,
    isJsonObject,
    readJsonBody,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const DISTRIBUTIONS = ['unlisted', 'public'] as const;
/** How the server refuses an AutoBot that isn't yours or shared with your organization. */
const NOT_FOUND = 'Dexto Autobot was not found.';

const AutobotSchema = z
    .object({
        id: z.string(),
        profile: z.object({ name: z.string() }).passthrough(),
        updatedAt: z.string(),
        visibility: z.string(),
    })
    .passthrough();
const AutobotResultSchema = z.object({ autobot: AutobotSchema }).passthrough();
const StatusSchema = z
    .object({
        autobot: z.object({ id: z.string(), name: z.string() }).passthrough(),
        status: z.string(),
        waitingOnUser: z.object({ text: z.string() }).passthrough().nullable(),
    })
    .passthrough();
const StatusPageSchema = z
    .object({
        pagination: z.object({ nextCursor: z.string().nullable() }).passthrough(),
        statuses: z.array(StatusSchema),
    })
    .passthrough();
const PublishSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('published') }).passthrough(),
    z
        .object({
            message: z.string(),
            skillsToPublish: z.array(z.unknown()),
            status: z.literal('confirmation_required'),
        })
        .passthrough(),
]);
const SubmittedSchema = z.object({ runId: z.string(), status: z.string() }).passthrough();
const ChatSchema = z
    .object({ session: z.object({ id: z.string(), url: z.string() }).passthrough() })
    .passthrough();

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

/** Calls an AutoBot tool; an AutoBot you can't use fails as not found. */
async function autobotTool(
    context: CommandContext,
    name: string,
    input: Record<string, unknown>
): Promise<unknown> {
    try {
        return await queryWorkspaceTool(context, name, input);
    } catch (error) {
        if (error instanceof CommandFailure && error.message === NOT_FOUND)
            throw new CommandFailure(
                'not_found',
                `There is no AutoBot you can use with that id.`,
                null
            );
        throw error;
    }
}

/** --limit within the tool's own bounds, checked before anything is sent. */
function limitOption(input: CommandInput, max: number): { limit?: number } {
    const limit = integerOption(input, 'limit');
    if (limit === undefined) return {};
    if (limit < 1 || limit > max) throw new UsageError(`--limit must be between 1 and ${max}.`);
    return { limit };
}

/** The JSON object from --data or --file; null when neither was given. */
async function jsonObjectBody(
    context: CommandContext,
    input: CommandInput
): Promise<Record<string, unknown> | null> {
    const body = await readJsonBody(context, input);
    if (body === null) return null;
    if (!isJsonObject(body)) throw new UsageError('The JSON must be an object.');
    return body;
}

const list: Command = {
    path: ['autobots', 'list'],
    summary:
        'List the AutoBots you can use: your own and those shared with your organization. Example: dexto autobots list --json',
    options: {
        limit: { description: 'How many to return, 1 to 50.', type: 'string', valueName: 'N' },
    },
    async run(context, input) {
        const limit = limitOption(input, 50);
        await requireLoginScopes(context, ['autobots:read']);
        const result = parsed(
            z.object({ autobots: z.array(AutobotSchema) }).passthrough(),
            await autobotTool(context, 'dexto_autobots_list', limit),
            'AutoBot list'
        );
        context.output.list({ data: result.autobots }, [
            { header: 'id', value: (autobot) => autobot.id },
            { header: 'name', value: (autobot) => autobot.profile.name },
            { header: 'visibility', value: (autobot) => autobot.visibility },
            { header: 'updated', value: (autobot) => autobot.updatedAt },
        ]);
    },
};

const get: Command = {
    path: ['autobots', 'get'],
    arguments: '<autobot_id>',
    summary: "Show an AutoBot's whole configuration and release state.",
    async run(context, input) {
        const autobotId = argument(input, 0, 'autobot_id');
        await requireLoginScopes(context, ['autobots:read']);
        context.output.record(
            parsed(
                AutobotResultSchema,
                await autobotTool(context, 'dexto_autobot_get', { autobotId }),
                'AutoBot'
            )
        );
    },
};

const status: Command = {
    path: ['autobots', 'status'],
    arguments: '[autobot_id]',
    summary:
        "Show one AutoBot's goals, runs and pending input, or a page of every AutoBot's status. Pending input has the approvalId that autobots input answers.",
    options: {
        after: {
            description: 'Start after this cursor, from the previous page. Not with an AutoBot id.',
            type: 'string',
            valueName: 'CURSOR',
        },
        limit: { description: 'How many to return, 1 to 20.', type: 'string', valueName: 'N' },
    },
    async run(context, input) {
        const autobotId = input.positionals[0];
        const cursor = stringOption(input, 'after');
        if (autobotId !== undefined && cursor !== undefined)
            throw new UsageError('Pass an AutoBot id or --after, not both.');
        const limit = limitOption(input, 20);
        await requireLoginScopes(context, ['autobots:read']);
        const page = parsed(
            StatusPageSchema,
            await autobotTool(context, 'dexto_autobot_status', {
                ...(autobotId === undefined ? {} : { autobotId }),
                ...(cursor === undefined ? {} : { cursor }),
                ...limit,
            }),
            'AutoBot status'
        );
        if (autobotId !== undefined) return context.output.record(page);
        const next = page.pagination.nextCursor;
        context.output.list({ data: page.statuses, has_more: next !== null, next_after: next }, [
            { header: 'id', value: (each) => each.autobot.id },
            { header: 'name', value: (each) => each.autobot.name },
            { header: 'status', value: (each) => each.status },
            { header: 'waiting on you', value: (each) => each.waitingOnUser?.text ?? '' },
        ]);
    },
};

const PROFILE_OPTIONS = {
    name: { description: 'Its name.', type: 'string' },
    role: { description: 'What it does, in a line.', type: 'string' },
    instructions: { description: 'How it works.', type: 'string' },
    avatar: {
        description: 'Sprite id shape-color-hat-eyewear, such as round-teal-none-none.',
        type: 'string',
    },
} as const;

const save: Command = {
    path: ['autobots', 'save'],
    arguments: '[autobot_id]',
    summary:
        'Create a private AutoBot (with --name and --role), or change one you can edit. Starters, model and skills go in --data or --file, each replaced whole. Example: dexto autobots save --name Scout --role "Watches competitors" --yes',
    options: { ...PROFILE_OPTIONS, ...BODY_OPTIONS, ...YES_OPTION },
    async run(context, input) {
        const autobotId = input.positionals[0];
        const body = (await jsonObjectBody(context, input)) ?? {};
        if ('autobotId' in body)
            throw new UsageError('Name the AutoBot to change as the argument, not in the JSON.');
        const profile = {
            ...(isJsonObject(body.profile) ? body.profile : {}),
            ...Object.fromEntries(
                Object.keys(PROFILE_OPTIONS).flatMap((field) => {
                    const value = stringOption(input, field);
                    return value === undefined ? [] : [[field, value]];
                })
            ),
        };
        const call = {
            ...body,
            ...(Object.keys(profile).length === 0 ? {} : { profile }),
            ...(autobotId === undefined ? {} : { autobotId }),
        };
        if (Object.keys(call).length === (autobotId === undefined ? 0 : 1))
            throw new UsageError('Nothing to save: pass profile flags, --data or --file.');
        await requireLoginScopes(context, ['autobots:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            autobotId === undefined
                ? 'Create a private AutoBot?'
                : `Change the AutoBot ${autobotId}? A shared AutoBot changes for everyone in your organization.`
        );
        const value = await autobotTool(context, 'dexto_autobot_save', call);
        const { autobot } = parsed(AutobotResultSchema, value, 'saved AutoBot');
        context.output.result(value, `Saved AutoBot ${autobot.profile.name} (${autobot.id}).`);
    },
};

const publish: Command = {
    path: ['autobots', 'publish'],
    arguments: '<autobot_id>',
    summary:
        'Publish a template from one of your own AutoBots, unlisted or public. Example: dexto autobots publish "$AUTOBOT_ID" --distribution unlisted --yes',
    options: {
        distribution: {
            description: `Who finds the template: ${DISTRIBUTIONS.join(' or ')}.`,
            type: 'string',
        },
        'publish-skills': {
            description: 'Also publish the Skills it uses that are not public yet.',
            type: 'boolean',
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const autobotId = argument(input, 0, 'autobot_id');
        const distribution = choiceOption(input, 'distribution', DISTRIBUTIONS);
        if (distribution === undefined) throw new UsageError('--distribution is required.');
        const publishSkills = flag(input, 'publish-skills');
        await requireLoginScopes(
            context,
            publishSkills ? ['autobots:write', 'skills:write'] : ['autobots:write']
        );
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Publish the AutoBot ${autobotId} as a ${distribution} template${publishSkills ? ', with its Skills' : ''}?`
        );
        const value = await autobotTool(context, 'dexto_autobot_publish', {
            autobotId,
            distribution,
            ...(publishSkills ? { publishSelectedSkills: true } : {}),
            confirm: true,
        });
        const result = parsed(PublishSchema, value, 'publish result');
        if (result.status === 'confirmation_required') {
            if (context.output.json) context.output.result(value, '');
            throw new CommandFailure(
                'needs_confirmation',
                `${result.message} Run it again with --publish-skills once your person has agreed.`,
                rerunWith(context, '--publish-skills')
            );
        }
        context.output.result(
            value,
            `Published AutoBot ${autobotId} as a ${distribution} template.`
        );
    },
};

const submitInput: Command = {
    path: ['autobots', 'input'],
    arguments: '<approval_id>',
    summary:
        'Answer an AutoBot run\'s request for input, from the approvalId autobots status shows. Example: dexto autobots input "$APPROVAL_ID" --data \'{"city":"Paris"}\' --yes',
    options: {
        data: {
            description: 'The form answers as a JSON object.',
            type: 'string',
            valueName: 'JSON',
        },
        file: {
            description: 'Read the form answers from a JSON file, or - for stdin.',
            type: 'string',
            valueName: 'PATH',
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const approvalId = argument(input, 0, 'approval_id');
        const formData = await jsonObjectBody(context, input);
        if (formData === null) throw new UsageError('Pass the answers with --data or --file.');
        await requireLoginScopes(context, ['autobots:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Send these answers to the AutoBot run waiting on ${approvalId}?`
        );
        const value = await autobotTool(context, 'dexto_autobot_input_submit', {
            approvalId,
            formData,
            confirm: true,
        });
        const submitted = parsed(SubmittedSchema, value, 'input result');
        context.output.result(value, `Sent. Run ${submitted.runId} is ${submitted.status}.`);
    },
};

const chat: Command = {
    path: ['autobots', 'chat'],
    arguments: '<autobot_id> <message>',
    summary:
        'Send a message in your own conversation with an AutoBot. Example: dexto autobots chat "$AUTOBOT_ID" "What changed this week?"',
    options: {
        title: {
            description: 'Title for the conversation, when this message starts it.',
            type: 'string',
            valueName: 'TEXT',
        },
    },
    async run(context, input) {
        const autobotId = argument(input, 0, 'autobot_id');
        const message = argument(input, 1, 'message');
        if (message.trim().length === 0) throw new UsageError('The message is empty.');
        const title = stringOption(input, 'title');
        await requireLoginScopes(context, ['autobots:write']);
        const value = await autobotTool(context, 'dexto_autobot_chat_start', {
            autobotId,
            message,
            ...(title === undefined ? {} : { title }),
        });
        const { session } = parsed(ChatSchema, value, 'AutoBot chat');
        context.output.result(value, `Sent to AutoBot ${autobotId}.\n${session.url}`);
    },
};

export const autobotCommands: readonly Command[] = [
    list,
    get,
    status,
    save,
    publish,
    submitInput,
    chat,
];
