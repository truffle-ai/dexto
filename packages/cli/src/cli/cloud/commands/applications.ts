// `applications`: inspect your managed Dockerfile Applications, their releases, runtime variable
// names and portable plugin files, read-only, over Dexto's typed Applications tools. Create, deploy
// and lifecycle changes stay with those tools.

import { z } from 'zod';
import { argument, type Command } from '../command.js';
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

type Application = z.output<typeof ApplicationSchema>;
type Release = z.output<typeof ReleaseSchema>;

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

const variables: Command = {
    arguments: '<application_id>',
    path: ['applications', 'variables'],
    summary:
        "List the names of an Application's runtime variables, never their values. Set values in Cloud, in the Application's Settings.",
    examples: ['dexto applications variables "$APPLICATION_ID" --json'],
    async run(context, input) {
        const applicationId = argument(input, 0, 'application_id');
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
        const applicationId = argument(input, 0, 'application_id');
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

export const applicationCommands: readonly Command[] = [
    list,
    get,
    release,
    logs,
    variables,
    exportPlugin,
];
