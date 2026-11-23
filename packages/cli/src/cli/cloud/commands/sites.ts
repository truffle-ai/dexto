// `cloud sites get` and `cloud sites promote`: read a Site you reach with its newest deployments,
// and make one ready deployment its production release, through the Dexto MCP's Site operations.

import { requireConsent } from '../../interaction.js';

import { z } from 'zod';

import { argument, flag, integerOption, YES_OPTION, type Command } from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const SiteSchema = z.object({
    productionUrl: z.string(),
    slug: z.string(),
    title: z.string(),
    visibility: z.string(),
});
const DeploymentSchema = z.object({
    channel: z.string(),
    createdAt: z.string(),
    id: z.string(),
    previewUrl: z.string().nullable(),
    status: z.string(),
});
const SiteWithDeploymentsSchema = z.object({
    deployments: z.array(DeploymentSchema),
    site: SiteSchema,
});
const PromotedSchema = z.object({
    deployment: z.object({ id: z.string() }),
    site: SiteSchema,
    url: z.string(),
});

const DEPLOYMENT_COLUMNS: readonly Column<z.output<typeof DeploymentSchema>>[] = [
    { header: 'id', value: (deployment) => deployment.id },
    { header: 'status', value: (deployment) => deployment.status },
    { header: 'channel', value: (deployment) => deployment.channel },
    { header: 'created', value: (deployment) => deployment.createdAt },
    { header: 'preview', value: (deployment) => deployment.previewUrl },
];

const getSite: Command = {
    arguments: '<site-id>',
    options: {
        limit: {
            description: 'How many of its newest deployments to show, 1 to 50 (default 20).',
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['cloud', 'sites', 'get'],
    summary: 'Show a Site you reach, by id, with its newest deployments.',
    async run(context, input) {
        await requireLoginScopes(context, ['sites:read']);
        const siteId = argument(input, 0, 'site-id');
        const deploymentLimit = integerOption(input, 'limit');
        const value = await queryWorkspaceTool(context, 'dexto_site_get', {
            ...(deploymentLimit === undefined ? {} : { deploymentLimit }),
            siteId,
        });
        if (context.output.json) return context.output.record(value);
        const { deployments, site } = SiteWithDeploymentsSchema.parse(value);
        context.runtime.writeOutput(
            `${site.slug} (${site.title}) ${site.productionUrl}, ${site.visibility}\n\n`
        );
        context.output.list({ data: deployments }, DEPLOYMENT_COLUMNS);
    },
};

const promoteSite: Command = {
    arguments: '<site-id> <deployment-id>',
    options: YES_OPTION,
    path: ['cloud', 'sites', 'promote'],
    summary:
        "Make a Site's ready deployment its live production release, by ids from dexto cloud sites get. Asks first.",
    async run(context, input) {
        await requireLoginScopes(context, ['sites:write']);
        const siteId = argument(input, 0, 'site-id');
        const deploymentId = argument(input, 1, 'deployment-id');
        await requireConsent(
            context,
            flag(input, 'yes'),
            `This makes deployment ${deploymentId} the live production release of Site ${siteId}.`
        );
        // The operation is at level approve: `confirm` is the sign that the person agreed.
        const value = await queryWorkspaceTool(context, 'dexto_site_promote', {
            confirm: true,
            deploymentId,
            siteId,
        });
        const promoted = PromotedSchema.parse(value);
        context.output.result(
            value,
            `Promoted deployment ${promoted.deployment.id} of ${promoted.site.slug}: live at ${promoted.url}.`
        );
    },
};

export const siteCommands: readonly Command[] = [getSite, promoteSite];
