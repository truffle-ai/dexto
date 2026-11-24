// `applications`: inspect your managed Dockerfile Applications, their releases, lifecycle, insights
// and usage, read-only, over Dexto's typed Applications tools. Create, deploy and lifecycle changes
// stay with those tools.

import { z } from 'zod';
import { argument, choiceOption, type Command } from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const SCOPES = ['applications:read'] as const;

const ApplicationSchema = z
    .object({ id: z.string(), slug: z.string(), status: z.string(), title: z.string() })
    .passthrough();
const ReleaseSchema = z
    .object({
        createdAt: z.string(),
        endpointUrl: z.string().nullable(),
        id: z.string(),
        slug: z.string(),
        status: z.string(),
    })
    .passthrough();
const ListSchema = z
    .object({ applications: z.array(ApplicationSchema), deployments: z.array(ReleaseSchema) })
    .passthrough();
const LogsSchema = z.object({ logs: z.string() }).passthrough();
const OperationSchema = z
    .object({
        action: z.string(),
        completedAt: z.string().nullable(),
        createdAt: z.string(),
        id: z.string(),
        status: z.string(),
    })
    .passthrough();
const OperationsSchema = z.object({ operations: z.array(OperationSchema) }).passthrough();
const EventSchema = z
    .object({ action: z.string(), createdAt: z.string(), status: z.string() })
    .passthrough();
const HistorySchema = z.object({ events: z.array(EventSchema) }).passthrough();
const InsightsSchema = z.object({ insights: z.record(z.string(), z.unknown()) }).passthrough();
// A null cost is one the provider has not reported, not zero.
const UsagePeriodSchema = z
    .object({
        end: z.string(),
        estimated: z.boolean(),
        estimatedCustomerCostUsd: z.number().nullable(),
        providerCostUsd: z.number().nullable(),
        start: z.string(),
    })
    .passthrough();
const UsageSchema = z
    .object({ periods: z.array(UsagePeriodSchema), totalChargeUsd: z.number() })
    .passthrough();

type Application = z.output<typeof ApplicationSchema>;
type Release = z.output<typeof ReleaseSchema>;
type Operation = z.output<typeof OperationSchema>;
type Event = z.output<typeof EventSchema>;
type UsagePeriod = z.output<typeof UsagePeriodSchema>;

const HISTORY_KINDS = ['project', 'release'] as const;

const APPLICATION_COLUMNS: readonly Column<Application>[] = [
    { header: 'id', value: (application) => application.id },
    { header: 'slug', value: (application) => application.slug },
    { header: 'title', value: (application) => application.title },
    { header: 'status', value: (application) => application.status },
];
const RELEASE_COLUMNS: readonly Column<Release>[] = [
    { header: 'release', value: (release) => release.id },
    { header: 'slug', value: (release) => release.slug },
    { header: 'status', value: (release) => release.status },
    { header: 'created', value: (release) => release.createdAt },
    { header: 'url', value: (release) => release.endpointUrl },
];
const OPERATION_COLUMNS: readonly Column<Operation>[] = [
    { header: 'operation', value: (operation) => operation.id },
    { header: 'action', value: (operation) => operation.action },
    { header: 'status', value: (operation) => operation.status },
    { header: 'created', value: (operation) => operation.createdAt },
    { header: 'completed', value: (operation) => operation.completedAt },
];
const EVENT_COLUMNS: readonly Column<Event>[] = [
    { header: 'created', value: (event) => event.createdAt },
    { header: 'action', value: (event) => event.action },
    { header: 'status', value: (event) => event.status },
];
// Every cost in a period is an estimate; settled charges are only the report's totalChargeUsd.
const USAGE_PERIOD_COLUMNS: readonly Column<UsagePeriod>[] = [
    { header: 'start', value: (period) => period.start },
    { header: 'end', value: (period) => period.end },
    { header: 'provisional', value: (period) => period.estimated },
    { header: 'estimated provider usd', value: (period) => period.providerCostUsd },
    { header: 'estimated cost usd', value: (period) => period.estimatedCustomerCostUsd },
];

const list: Command = {
    path: ['applications', 'list'],
    summary: 'List your Applications in this organization and their recent releases.',
    examples: ['dexto applications list --json'],
    async run(context) {
        await requireLoginScopes(context, SCOPES);
        const result = ListSchema.parse(
            await queryWorkspaceTool(context, 'dexto_applications_list', {})
        );
        // JSON keeps the tool's own response; people get one table per kind.
        if (context.output.json) return context.output.record(result);
        context.output.list({ data: result.applications }, APPLICATION_COLUMNS);
        if (result.deployments.length > 0)
            context.output.list({ data: result.deployments }, RELEASE_COLUMNS);
    },
};

const get: Command = {
    arguments: '<application_id>',
    path: ['applications', 'get'],
    summary: 'Show one Application, checking its provisioning while it is not ready.',
    examples: ['dexto applications get "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = argument(input, 0, 'application_id');
        await requireLoginScopes(context, SCOPES);
        context.output.record(
            ApplicationSchema.parse(
                await queryWorkspaceTool(context, 'dexto_application_get', { applicationId })
            )
        );
    },
};

const release: Command = {
    arguments: '<deployment_id>',
    path: ['applications', 'release'],
    summary: "Show one release: its status, URL and progress, from a deploy's deploymentId.",
    examples: ['dexto applications release "$DEPLOYMENT_ID" --json'],
    async run(context, input) {
        const deploymentId = argument(input, 0, 'deployment_id');
        await requireLoginScopes(context, SCOPES);
        context.output.record(
            ReleaseSchema.parse(
                await queryWorkspaceTool(context, 'dexto_application_release_get', { deploymentId })
            )
        );
    },
};

const logs: Command = {
    arguments: '<deployment_id>',
    path: ['applications', 'logs'],
    summary: "Read one release's recent logs, bounded and redacted.",
    examples: ['dexto applications logs "$DEPLOYMENT_ID" --json'],
    async run(context, input) {
        const deploymentId = argument(input, 0, 'deployment_id');
        await requireLoginScopes(context, SCOPES);
        const result = LogsSchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_logs', { deploymentId })
        );
        context.output.result(result, result.logs);
    },
};

const operations: Command = {
    arguments: '<application_id>',
    path: ['applications', 'operations'],
    summary:
        "List an Application's suspend, resume, retire and purge operations and their progress.",
    examples: ['dexto applications operations "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = argument(input, 0, 'application_id');
        await requireLoginScopes(context, SCOPES);
        const result = OperationsSchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_operations_list', {
                applicationId,
            })
        );
        if (context.output.json) return context.output.record(result);
        context.output.list({ data: result.operations }, OPERATION_COLUMNS);
    },
};

const history: Command = {
    arguments: '<resource_id>',
    options: {
        kind: {
            description:
                "project (the default) for an Application's history from its id, release for one release's from its deploymentId.",
            type: 'string',
            valueName: 'KIND',
        },
    },
    path: ['applications', 'history'],
    summary:
        'Read the safe lifecycle history of an Application or one release, without contacting the provider.',
    examples: [
        'dexto applications history "$APPLICATION_ID" --json',
        'dexto applications history "$DEPLOYMENT_ID" --kind release --json',
    ],
    async run(context, input) {
        const resourceKind = choiceOption(input, 'kind', HISTORY_KINDS) ?? 'project';
        const resourceId = argument(input, 0, 'resource_id');
        await requireLoginScopes(context, SCOPES);
        const result = HistorySchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_history', {
                resourceId,
                resourceKind,
            })
        );
        if (context.output.json) return context.output.record(result);
        context.output.list({ data: result.events }, EVENT_COLUMNS);
    },
};

const insights: Command = {
    arguments: '<application_id>',
    path: ['applications', 'insights'],
    summary:
        "Read an Application's timestamped measurements; an unavailable metric stays null, never zero.",
    examples: ['dexto applications insights "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = argument(input, 0, 'application_id');
        await requireLoginScopes(context, SCOPES);
        const result = InsightsSchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_insights', { applicationId })
        );
        context.output.record(context.output.json ? result : result.insights);
    },
};

const usage: Command = {
    arguments: '<application_id>',
    path: ['applications', 'usage'],
    summary:
        "Read an Application's daily AWS cost estimates and, separately, its settled hosting charges.",
    examples: ['dexto applications usage "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = argument(input, 0, 'application_id');
        await requireLoginScopes(context, SCOPES);
        const result = UsageSchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_usage', { applicationId })
        );
        if (context.output.json) return context.output.record(result);
        const { periods, totalChargeUsd, ...report } = result;
        context.output.record({ ...report, settledChargeUsd: totalChargeUsd });
        context.output.list({ data: periods }, USAGE_PERIOD_COLUMNS);
    },
};

export const applicationCommands: readonly Command[] = [
    list,
    get,
    release,
    logs,
    operations,
    history,
    insights,
    usage,
];
