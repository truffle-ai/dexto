// `cloud automations`: run the project's agents on a schedule or on a signed webhook.

import { unwrap, type V1Body, type V1Response } from '@dexto/cloud-client';

import {
    argument,
    BODY_OPTIONS,
    PAGE_OPTIONS,
    pageQuery,
    readJsonBody,
    requireConsent,
    stringOption,
    UsageError,
    YES_OPTION,
    flag,
    isJsonObject,
    type Command,
    type CommandInput,
} from '../command.js';
import type { Column } from '../output.js';

type Automation = V1Response<'/v1/automations/{automation_id}', 'get'>;
type AutomationCreateInput = V1Body<'/v1/automations', 'post'>;
type AutomationUpdateInput = V1Body<'/v1/automations/{automation_id}', 'patch'>;

function automationPath(id: string) {
    return { params: { path: { automation_id: id } } };
}

const COLUMNS: readonly Column<Automation>[] = [
    { header: 'id', value: (automation) => automation.id },
    { header: 'name', value: (automation) => automation.name },
    { header: 'status', value: (automation) => automation.status },
    { header: 'trigger', value: (automation) => describeTrigger(automation) },
    { header: 'agent', value: (automation) => automation.target.agent_id },
    { header: 'last fired', value: (automation) => automation.last_fired_at },
];

const list: Command = {
    options: PAGE_OPTIONS,
    path: ['cloud', 'automations', 'list'],
    summary: "List the project's automations.",
    async run(context, input) {
        context.output.list(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/automations', {
                    params: { query: pageQuery(input) },
                })
            ),
            COLUMNS
        );
    },
};

const get: Command = {
    arguments: '<automation_id>',
    path: ['cloud', 'automations', 'get'],
    summary: 'Show an automation.',
    async run(context, input) {
        context.output.record(
            await unwrap(
                await (
                    await context.client()
                ).GET(
                    '/v1/automations/{automation_id}',
                    automationPath(argument(input, 0, 'automation_id'))
                )
            )
        );
    },
};

const create: Command = {
    options: {
        ...BODY_OPTIONS,
        agent: { description: 'The agent each firing runs.', type: 'string', valueName: 'ID' },
        at: {
            description: 'Fire once at this ISO 8601 time with an offset.',
            type: 'string',
            valueName: 'TIME',
        },
        cron: { description: 'Fire on this five-field cron expression.', type: 'string' },
        message: { description: 'The message each firing sends the agent.', type: 'string' },
        name: { description: 'Display name.', type: 'string' },
        session: {
            description: 'Send every firing to this session instead of a new one each time.',
            type: 'string',
            valueName: 'ID',
        },
        timezone: {
            description: 'The IANA timezone the cron is read in (default UTC).',
            type: 'string',
        },
        webhook: { description: 'Fire on each signed request to a webhook URL.', type: 'boolean' },
    },
    path: ['cloud', 'automations', 'create'],
    summary:
        'Create an automation from flags (--name --agent --message and one of --cron, --at, --webhook) or --file.',
    async run(context, input) {
        const body = await readJsonBody(context, input);
        const definition = body === null ? fromFlags(input) : asCreateInput(body);
        const automation = await unwrap(
            await (await context.client()).POST('/v1/automations', { body: definition })
        );
        if (context.output.json) return context.output.record(automation);
        context.runtime.writeOutput(`Created automation ${automation.id} (${automation.name}).\n`);
        if (automation.trigger.type === 'webhook') {
            context.runtime.writeOutput(`Webhook URL: ${automation.trigger.url}\n`);
            context.runtime.writeOutput(
                `Signing secret (shown once): ${automation.webhook_secret ?? '-'}\n`
            );
        } else if (automation.trigger.next_run_at !== null)
            context.runtime.writeOutput(`Next run: ${automation.trigger.next_run_at}\n`);
    },
};

const update: Command = {
    arguments: '<automation_id>',
    options: {
        ...BODY_OPTIONS,
        message: { description: 'The message each firing sends.', type: 'string' },
        name: { description: 'Display name.', type: 'string' },
    },
    path: ['cloud', 'automations', 'update'],
    summary: "Change an automation's name or message, or any field with --file.",
    async run(context, input) {
        const body = await readJsonBody(context, input);
        const name = stringOption(input, 'name');
        const message = stringOption(input, 'message');
        const changes: AutomationUpdateInput =
            body === null
                ? {
                      ...(name === undefined ? {} : { name }),
                      ...(message === undefined ? {} : { target: { message } }),
                  }
                : asUpdateInput(body);
        const automation = await unwrap(
            await (
                await context.client()
            ).PATCH('/v1/automations/{automation_id}', {
                ...automationPath(argument(input, 0, 'automation_id')),
                body: changes,
            })
        );
        context.output.result(automation, `Updated automation ${automation.id}.`);
    },
};

function lifecycle(action: 'delete' | 'pause' | 'resume' | 'run', summary: string): Command {
    return {
        arguments: '<automation_id>',
        ...(action === 'delete' ? { options: YES_OPTION } : {}),
        path: ['cloud', 'automations', action],
        summary,
        async run(context, input) {
            const client = await context.client();
            const id = argument(input, 0, 'automation_id');
            if (action === 'delete') {
                await requireConsent(
                    context,
                    flag(input, 'yes'),
                    `Deleting automation ${id} removes it and its firing history for good.`
                );
                const result = await unwrap(
                    await client.DELETE('/v1/automations/{automation_id}', automationPath(id))
                );
                return context.output.result(result, `Deleted automation ${id}.`);
            }
            if (action === 'run') {
                const firing = await unwrap(
                    await client.POST('/v1/automations/{automation_id}/run', automationPath(id))
                );
                return context.output.result(
                    firing,
                    `Fired ${firing.id}: ${firing.status}${firing.run_id === null ? '' : `, run ${firing.run_id} in session ${firing.session_id ?? '-'}`}.`
                );
            }
            const automation = await unwrap(
                action === 'pause'
                    ? await client.POST('/v1/automations/{automation_id}/pause', automationPath(id))
                    : await client.POST(
                          '/v1/automations/{automation_id}/resume',
                          automationPath(id)
                      )
            );
            context.output.result(automation, `Automation ${id} is ${automation.status}.`);
        },
    };
}

const firings: Command = {
    arguments: '<automation_id>',
    options: PAGE_OPTIONS,
    path: ['cloud', 'automations', 'firings'],
    summary: "List an automation's firings, newest first, with each run's status.",
    async run(context, input) {
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/automations/{automation_id}/firings', {
                params: {
                    path: { automation_id: argument(input, 0, 'automation_id') },
                    query: pageQuery(input),
                },
            })
        );
        context.output.list(page, [
            { header: 'id', value: (firing) => firing.id },
            { header: 'source', value: (firing) => firing.source },
            { header: 'status', value: (firing) => firing.status },
            { header: 'run', value: (firing) => firing.run_id },
            { header: 'fired', value: (firing) => firing.fired_at },
        ]);
    },
};

const rotate: Command = {
    arguments: '<automation_id>',
    options: YES_OPTION,
    path: ['cloud', 'automations', 'rotate-secret'],
    summary: "Replace a webhook's signing secret; the old one stops at once.",
    async run(context, input) {
        const id = argument(input, 0, 'automation_id');
        await requireConsent(
            context,
            flag(input, 'yes'),
            `The webhook's current signing secret stops working at once; senders need the new one.`
        );
        const secret = await unwrap(
            await (
                await context.client()
            ).POST('/v1/automations/{automation_id}/webhook/rotate_secret', automationPath(id))
        );
        context.output.result(secret, `New signing secret (shown once): ${secret.webhook_secret}`);
    },
};

function fromFlags(input: CommandInput): AutomationCreateInput {
    const name = stringOption(input, 'name');
    const agentId = stringOption(input, 'agent');
    const message = stringOption(input, 'message');
    if (name === undefined || agentId === undefined || message === undefined)
        throw new UsageError('An automation needs --name, --agent and --message, or --file.');
    const cron = stringOption(input, 'cron');
    const at = stringOption(input, 'at');
    const webhook = flag(input, 'webhook');
    if ([cron !== undefined, at !== undefined, webhook].filter(Boolean).length !== 1)
        throw new UsageError('Pass exactly one of --cron, --at or --webhook.');
    const sessionId = stringOption(input, 'session');
    return {
        name,
        target: {
            agent_id: agentId,
            message,
            ...(sessionId === undefined
                ? {}
                : { session: { mode: 'fixed', session_id: sessionId } }),
            type: 'agent',
        },
        trigger: webhook
            ? { type: 'webhook' }
            : {
                  schedule:
                      cron === undefined
                          ? { run_at: at ?? '', type: 'once' }
                          : {
                                cron,
                                timezone: stringOption(input, 'timezone') ?? 'UTC',
                                type: 'recurring',
                            },
                  type: 'schedule',
              },
    };
}

/** The API validates the whole body; the CLI checks only its shape. */
function isCreateInput(value: unknown): value is AutomationCreateInput {
    return (
        isJsonObject(value) &&
        typeof value.name === 'string' &&
        isJsonObject(value.target) &&
        isJsonObject(value.trigger)
    );
}

function asCreateInput(value: unknown): AutomationCreateInput {
    if (!isCreateInput(value))
        throw new UsageError('An automation needs name, and target and trigger objects.');
    return value;
}

function isUpdateInput(value: unknown): value is AutomationUpdateInput {
    return isJsonObject(value);
}

function asUpdateInput(value: unknown): AutomationUpdateInput {
    if (!isUpdateInput(value)) throw new UsageError('The changes must be a JSON object.');
    return value;
}

function describeTrigger(automation: Automation): string {
    const trigger = automation.trigger;
    if (trigger.type === 'webhook') return 'webhook';
    return trigger.schedule.type === 'once'
        ? `once ${trigger.schedule.run_at}`
        : `${trigger.schedule.cron} ${trigger.schedule.timezone}`;
}

export const automationCommands: readonly Command[] = [
    list,
    get,
    create,
    update,
    lifecycle('pause', "Stop an automation's schedule."),
    lifecycle('resume', 'Resume a paused automation.'),
    lifecycle('run', 'Fire an automation now, whatever its status.'),
    lifecycle('delete', 'Delete an automation and its firing history.'),
    firings,
    rotate,
];
