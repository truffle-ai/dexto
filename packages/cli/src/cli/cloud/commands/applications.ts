// `applications`: your managed Dockerfile Applications over Dexto's typed Applications tools.
// Read their releases, runtime variable names, portable plugin files, lifecycle, insights and
// usage; create, deploy, roll back, suspend, resume, retire, purge and install them, each write
// only once the person agrees.

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { CloudApiError } from '@dexto/cloud-client';
import { z } from 'zod';
import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    choiceOption,
    flag,
    requiredOption,
    stringOption,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import type { Column } from '../output.js';
import { readPackage, uploadPackage, type PackageKind } from './apps.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool, WorkspaceToolFailure } from './workspace.js';

const SCOPES = ['applications:read'] as const;
const WRITE_SCOPES = ['applications:write'] as const;
const APPLICATION_PACKAGE: PackageKind = {
    label: 'an Application package',
    maxBytes: 5 * 1024 * 1024,
    purpose: 'application-package',
};

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
// Not passthrough: the CLI keeps variable names only, whatever else a response carries.
const VariablesSchema = z.object({
    configuration: z.object({ appliesOn: z.string(), names: z.array(z.string()) }),
});
const PluginExportSchema = z
    .object({
        files: z.array(z.object({ content: z.string(), path: z.string() })),
        publication: z.string(),
    })
    .passthrough();
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
        const applicationId = idArgument(input, 0, 'application_id');
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
        const deploymentId = idArgument(input, 0, 'deployment_id');
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
        const deploymentId = idArgument(input, 0, 'deployment_id');
        await requireLoginScopes(context, SCOPES);
        const result = LogsSchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_logs', { deploymentId })
        );
        context.output.result(result, result.logs);
    },
};

const variables: Command = {
    arguments: '<application_id>',
    path: ['applications', 'variables'],
    summary:
        "List the names of an Application's runtime variables, never their values. Set values in Cloud, in the Application's Settings.",
    examples: ['dexto applications variables "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = idArgument(input, 0, 'application_id');
        await requireLoginScopes(context, SCOPES);
        const result = VariablesSchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_variables_list', {
                applicationId,
            })
        );
        const { names } = result.configuration;
        context.output.result(
            result,
            names.length === 0
                ? 'No runtime variables.'
                : [...names, 'Changes apply on the next deployment.'].join('\n')
        );
    },
};

const exportPlugin: Command = {
    arguments: '<application_id>',
    path: ['applications', 'export-plugin'],
    summary:
        "Print a healthy Application's portable plugin files (plugin.json, mcp.json and its skills), without credentials. Publishes and installs nothing.",
    examples: ['dexto applications export-plugin "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = idArgument(input, 0, 'application_id');
        await requireLoginScopes(context, SCOPES);
        const result = PluginExportSchema.parse(
            await queryWorkspaceTool(context, 'dexto_application_plugin_export', {
                applicationId,
            })
        );
        context.output.result(
            result,
            [
                // Each file's own final newline would leave a blank line before the next header.
                ...result.files.flatMap((file) => [
                    `==> ${file.path} <==`,
                    file.content.replace(/\n$/, ''),
                ]),
                result.publication,
            ].join('\n')
        );
    },
};

const operations: Command = {
    arguments: '<application_id>',
    path: ['applications', 'operations'],
    summary:
        "List an Application's suspend, resume, retire and purge operations and their progress.",
    examples: ['dexto applications operations "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = idArgument(input, 0, 'application_id');
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
        const resourceId = idArgument(input, 0, 'resource_id');
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
        const applicationId = idArgument(input, 0, 'application_id');
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
        const applicationId = idArgument(input, 0, 'application_id');
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

const WRITE_OPTIONS = {
    'dry-run': {
        description:
            "Check the arguments here and show the call without sending it. Dexto checks nothing: not your access, the Application's owner or whether its ids exist.",
        type: 'boolean',
    },
    ...YES_OPTION,
} as const satisfies Record<string, OptionSpec>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** An id the tools take as a UUID, checked here so a wrong one says what it should be. */
function checkedUuid(value: string, name: string): string {
    if (UUID.test(value)) return value;
    throw new CommandFailure(
        'invalid_input',
        `${name} must be a UUID (8-4-4-4-12 hex digits); got ${JSON.stringify(value)}.`,
        null
    );
}

function idArgument(input: CommandInput, index: number, name: string): string {
    return checkedUuid(argument(input, index, name), name);
}

/** A deploy's target: `app-<application id>`, the connectionId applications get shows. */
function connectionIdArgument(input: CommandInput): string {
    const value = argument(input, 0, 'connection_id');
    if (value.startsWith('app-') && UUID.test(value.slice('app-'.length))) return value;
    throw new CommandFailure(
        'invalid_input',
        UUID.test(value)
            ? `connection_id is app-<application id>, not a bare id. If ${value} is the Application's id, pass app-${value}.`
            : `connection_id must be app-<application id>, the connectionId applications get shows; got ${JSON.stringify(value)}.`,
        null
    );
}

/** The kinds of new UUID a write takes, each by its own `--<kind>-id` option. */
type IdKind = 'application' | 'deployment' | 'operation';

function idOption(kind: IdKind): Record<string, OptionSpec> {
    return {
        [`${kind}-id`]: {
            description: `A new ${kind} id (UUID) for this call; reuse it only to retry it. One is made when you leave it out, and printed.`,
            type: 'string',
            valueName: 'UUID',
        },
    };
}

/** The write's new id: its `--<kind>-id`, or a fresh one. */
function newId(input: CommandInput, kind: IdKind): string {
    const given = stringOption(input, `${kind}-id`);
    return given === undefined ? randomUUID() : checkedUuid(given, `--${kind}-id`);
}

/**
 * With --dry-run, shows the call and returns true: nothing is sent, so only what the CLI checks
 * itself (the ids' shape, a deploy's package) was checked.
 */
function showedDryRun(
    context: CommandContext,
    input: CommandInput,
    tool: string,
    args: Record<string, unknown>
): boolean {
    if (!flag(input, 'dry-run')) return false;
    context.output.result(
        { arguments: args, checkedByDexto: false, dryRun: true, tool },
        `Would call ${tool}. Nothing was sent, so Dexto checked nothing: not your access, the Application's owner or whether its ids exist.`
    );
    return true;
}

/**
 * Whether a failed write is worth sending again with the same id: it may have acted (the response
 * was lost) or the server said a retry can succeed. A refusal fails the same way again.
 */
function mayRetry(error: unknown): boolean {
    if (error instanceof WorkspaceToolFailure) return error.data.retryable;
    if (error instanceof CloudApiError) return error.retryable;
    return !(error instanceof CommandFailure);
}

/** Checks the sign-in can write, then that the person agreed, by --yes or at the terminal. */
async function agreeToWrite(
    context: CommandContext,
    input: CommandInput,
    consent: string
): Promise<void> {
    await requireLoginScopes(context, WRITE_SCOPES);
    await requireConsent(context, flag(input, 'yes'), consent);
}

/**
 * Makes one approval-level Application call once the person agrees, sending `confirm: true` as
 * the server's sign that they did. Its new id, if any, is printed first, and how to retry with it
 * only after a failure a retry can get past, so a lost response is retried without acting twice.
 */
async function writeApplication(
    context: CommandContext,
    input: CommandInput,
    write: {
        readonly args: Record<string, unknown>;
        readonly consent: string;
        readonly id: { readonly kind: IdKind; readonly value: string } | null;
        readonly tool: string;
    }
): Promise<void> {
    if (showedDryRun(context, input, write.tool, write.args)) return;
    await agreeToWrite(context, input, write.consent);
    const { id } = write;
    if (id !== null) context.output.note(`New ${id.kind} id: ${id.value}.`);
    try {
        context.output.record(
            await queryWorkspaceTool(context, write.tool, { ...write.args, confirm: true })
        );
    } catch (error) {
        if (id !== null && mayRetry(error))
            context.output.note(`To retry: --${id.kind}-id ${id.value}`);
        throw error;
    }
}

const create: Command = {
    arguments: '<slug> <title>',
    options: {
        project: {
            description:
                'An unarchived Cloud project to place it in; the Default project when left out.',
            type: 'string',
            valueName: 'CLOUD_PROJECT_ID',
        },
        ...idOption('application'),
        ...WRITE_OPTIONS,
    },
    path: ['applications', 'create'],
    summary:
        'Create a Dockerfile Application with its own database, auth and object storage. Dexto provisions every credential. Poll applications get until it is ready. Requires applications:write.',
    examples: ['dexto applications create orders "Orders" --yes --json'],
    async run(context, input) {
        const slug = argument(input, 0, 'slug');
        const title = argument(input, 1, 'title');
        const applicationId = newId(input, 'application');
        const project = stringOption(input, 'project');
        const cloudProjectId =
            project === undefined ? undefined : checkedUuid(project, '--project');
        await writeApplication(context, input, {
            args: {
                applicationId,
                slug,
                title,
                ...(cloudProjectId === undefined ? {} : { cloudProjectId }),
            },
            consent: `Create Application ${slug}?`,
            id: { kind: 'application', value: applicationId },
            tool: 'dexto_application_create',
        });
    },
};

const deploy: Command = {
    arguments: '<connection_id> <package>',
    options: { ...idOption('deployment'), ...WRITE_OPTIONS },
    path: ['applications', 'deploy'],
    summary:
        'Deploy an Application package (its deploy-request.json, up to 5 MiB, with a Dockerfile) to the Application whose connectionId applications get shows. A healthy release takes over the same URL; follow it with applications release. Requires applications:write.',
    examples: [
        'dexto applications deploy "$CONNECTION_ID" ./orders/deploy-request.json --yes --json',
    ],
    async run(context, input) {
        const connectionId = connectionIdArgument(input);
        const file = argument(input, 1, 'package');
        const bytes = await readPackage(file, APPLICATION_PACKAGE);
        const deploymentId = newId(input, 'deployment');
        const args = { connectionId, deploymentId };
        if (showedDryRun(context, input, 'dexto_application_deploy', args)) return;
        await agreeToWrite(context, input, `Deploy ${path.basename(file)} to ${connectionId}?`);
        // Dexto checks the package, then takes the upload: one upload makes one release, so a
        // lost response is followed with release, never deployed again.
        context.output.note(
            `New deployment id: ${deploymentId}. Follow it: dexto applications release ${deploymentId}`
        );
        const uploadPath = await uploadPackage(context, bytes, APPLICATION_PACKAGE);
        context.output.record(
            await queryWorkspaceTool(context, 'dexto_application_deploy', {
                ...args,
                confirm: true,
                uploadPath,
            })
        );
    },
};

const rollback: Command = {
    arguments: '<application_id> <release_id>',
    options: { ...idOption('deployment'), ...WRITE_OPTIONS },
    path: ['applications', 'rollback'],
    summary:
        "Roll an Application back to a retained healthy release, by that release's deploymentId: its image is redeployed without a rebuild, on the same URL, with the current runtime variables. Database changes stay. Requires applications:write.",
    examples: ['dexto applications rollback "$APPLICATION_ID" "$DEPLOYMENT_ID" --yes --json'],
    async run(context, input) {
        const applicationId = idArgument(input, 0, 'application_id');
        const rollbackFromId = idArgument(input, 1, 'release_id');
        const deploymentId = newId(input, 'deployment');
        await writeApplication(context, input, {
            args: { applicationId, deploymentId, rollbackFromId },
            consent: `Roll Application ${applicationId} back to release ${rollbackFromId}?`,
            id: { kind: 'deployment', value: deploymentId },
            tool: 'dexto_application_rollback',
        });
    },
};

const releaseDelete: Command = {
    arguments: '<deployment_id>',
    options: WRITE_OPTIONS,
    path: ['applications', 'release', 'delete'],
    summary:
        "Retire one release's compute. The Application's data stays. Inspect a release that is still deploying first. Requires applications:write.",
    examples: ['dexto applications release delete "$DEPLOYMENT_ID" --yes --json'],
    async run(context, input) {
        const deploymentId = idArgument(input, 0, 'deployment_id');
        await writeApplication(context, input, {
            args: { deploymentId },
            consent: `Retire release ${deploymentId}'s compute? This can't be undone.`,
            id: null,
            tool: 'dexto_application_release_delete',
        });
    },
};

/** A lifecycle change: one call by applicationId under an operation id, followed with operations. */
function lifecycleCommand(
    action: 'resume' | 'retire' | 'suspend',
    summary: string,
    consent: (applicationId: string) => string
): Command {
    return {
        arguments: '<application_id>',
        options: { ...idOption('operation'), ...WRITE_OPTIONS },
        path: ['applications', action],
        summary: `${summary} Follow it with applications operations. Requires applications:write.`,
        examples: [`dexto applications ${action} "$APPLICATION_ID" --yes --json`],
        async run(context, input) {
            const applicationId = idArgument(input, 0, 'application_id');
            const operationId = newId(input, 'operation');
            await writeApplication(context, input, {
                args: { applicationId, operationId },
                consent: consent(applicationId),
                id: { kind: 'operation', value: operationId },
                tool: `dexto_application_${action}`,
            });
        },
    };
}

const suspend = lifecycleCommand(
    'suspend',
    'Suspend an Application: stop its tasks. Its database, objects and HTTPS ingress stay, and keep costing money.',
    (applicationId) => `Suspend Application ${applicationId}?`
);
const resume = lifecycleCommand(
    'resume',
    'Resume a suspended Application: restart the same service.',
    (applicationId) => `Resume Application ${applicationId}?`
);
const retire = lifecycleCommand(
    'retire',
    "Retire an Application: permanently remove its compute, keeping its database, auth users and objects. It purges no data and doesn't stop every cost.",
    (applicationId) =>
        `Permanently remove Application ${applicationId}'s compute? This can't be undone.`
);

const purge: Command = {
    arguments: '<application_id>',
    options: {
        'confirm-application-id': {
            description:
                "The application id again, confirming which Application's data is destroyed.",
            type: 'string',
            valueName: 'APPLICATION_ID',
        },
        ...idOption('operation'),
        ...WRITE_OPTIONS,
    },
    path: ['applications', 'purge'],
    summary:
        "Irreversibly purge a fully retired Application's backend: its database and backups, auth users, objects, images and runtime variable values. Billing and audit records stay. Requires applications:write.",
    examples: [
        'dexto applications purge "$APPLICATION_ID" --confirm-application-id "$APPLICATION_ID" --yes --json',
    ],
    async run(context, input) {
        const applicationId = idArgument(input, 0, 'application_id');
        const confirmApplicationId = checkedUuid(
            requiredOption(input, 'confirm-application-id'),
            '--confirm-application-id'
        );
        const operationId = newId(input, 'operation');
        await writeApplication(context, input, {
            args: { applicationId, confirmApplicationId, operationId },
            consent: `Destroy Application ${applicationId}'s data for good? This can't be undone.`,
            id: { kind: 'operation', value: operationId },
            tool: 'dexto_application_purge',
        });
    },
};

const install: Command = {
    arguments: '<application_id>',
    options: WRITE_OPTIONS,
    path: ['applications', 'install'],
    summary:
        'Install a healthy Application that has a Dexto app manifest into your app drawer. It copies no backend, data or credentials. Requires applications:write.',
    examples: ['dexto applications install "$APPLICATION_ID" --yes --json'],
    async run(context, input) {
        const applicationId = idArgument(input, 0, 'application_id');
        await writeApplication(context, input, {
            args: { applicationId },
            consent: `Install Application ${applicationId} into your app drawer?`,
            id: null,
            tool: 'dexto_application_install',
        });
    },
};

export const applicationCommands: readonly Command[] = [
    list,
    get,
    release,
    logs,
    variables,
    exportPlugin,
    operations,
    history,
    insights,
    usage,
    create,
    deploy,
    rollback,
    releaseDelete,
    suspend,
    resume,
    retire,
    purge,
    install,
];
