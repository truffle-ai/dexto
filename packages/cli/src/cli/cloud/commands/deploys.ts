// `cloud sites` and `cloud functions`: pack a project with its own packer, deploy, list and delete.

import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import {
    argument,
    CommandFailure,
    flag,
    MissingScopeFailure,
    requireConsent,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
    type OptionSpec,
    YES_OPTION,
} from '../command.js';
import type { Column } from '../output.js';
import { callV1 } from '../v1.js';

type Kind = 'function' | 'site';

const PACKER = path.join('.dexto', 'pack.mjs');
const PROVIDERS = ['cloudflare-workers', 'aws-lambda'] as const;

const SiteSchema = z.object({
    id: z.string(),
    slug: z.string(),
    url: z.string(),
    visibility: z.string(),
});
const FunctionSchema = z.object({
    access: z.string(),
    id: z.string(),
    slug: z.string(),
    status: z.string(),
    url: z.string().nullable(),
});
const DeployedSiteSchema = z.object({
    deployment: z.object({ id: z.string() }),
    promoted: z.boolean(),
    site: z.object({ id: z.string(), slug: z.string() }),
    url: z.string(),
});
const DeployedFunctionSchema = z.object({
    deployment: z.object({ id: z.string(), preview_url: z.string() }),
    dexto: z.object({ configured: z.boolean(), scopes: z.array(z.string()) }).nullable(),
    function: z.object({ id: z.string(), slug: z.string() }),
    promoted: z.boolean(),
    url: z.string().nullable(),
});

const DEPLOY_OPTIONS = {
    'no-promote': {
        description: 'Deploy a preview to promote later, instead of making it live.',
        type: 'boolean',
    },
    provider: {
        description: `Where its Function runs: ${PROVIDERS.join(' or ')}. Omit for the default.`,
        type: 'string',
        valueName: 'PROVIDER',
    },
} as const satisfies Record<string, OptionSpec>;

const deploySite: Command = {
    arguments: '[dir]',
    options: DEPLOY_OPTIONS,
    path: ['cloud', 'sites', 'deploy'],
    summary:
        'Pack the Site in dir (default: here) with its packer and deploy it to the Cloud project; it goes live unless --no-promote.',
    async run(context, input) {
        await requireLoginScopes(context, ['sites:write', 'cloud:write']);
        // Options are checked before packing, which can build and rewrite project files.
        const query = deployQuery(input, {});
        const packed = await pack(context, input.positionals[0], 'site');
        const deployed = DeployedSiteSchema.parse(
            await callV1(context, 'POST', `/v1/sites/deployments?${query}`, packed)
        );
        context.output.result(
            deployed,
            deployed.promoted
                ? `Deployed ${deployed.site.slug} to ${deployed.url} (deployment ${deployed.deployment.id}).`
                : `Deployed a preview of ${deployed.site.slug} at ${deployed.url}. Make it live with: dexto cloud api POST /v1/sites/${deployed.site.id}/deployments/${deployed.deployment.id}/promote`
        );
    },
};

const deployFunction: Command = {
    arguments: '[dir]',
    options: {
        ...DEPLOY_OPTIONS,
        public: {
            description: 'Let anyone on the internet reach it. Functions are private by default.',
            type: 'boolean',
        },
    },
    path: ['cloud', 'functions', 'deploy'],
    summary:
        'Pack the Function in dir (default: here) with its packer and deploy it to the Cloud project; it goes live unless --no-promote.',
    async run(context, input) {
        await requireLoginScopes(context, ['functions:write', 'cloud:write']);
        // Options are checked before packing, which can build and rewrite project files.
        const query = deployQuery(input, {
            access: flag(input, 'public') ? 'public' : 'private',
        });
        const packed = await pack(context, input.positionals[0], 'function');
        const deployed = DeployedFunctionSchema.parse(
            await callV1(context, 'POST', `/v1/functions/deployments?${query}`, packed)
        );
        const key =
            deployed.dexto === null || deployed.dexto.configured
                ? ''
                : ` Its Dexto key was not bound: your sign-in lacks ${deployed.dexto.scopes.join(', ')}.`;
        context.output.result(
            deployed,
            deployed.promoted
                ? `Deployed ${deployed.function.slug}${deployed.url === null ? '' : ` to ${deployed.url}`} (deployment ${deployed.deployment.id}).${key}`
                : `Deployed ${deployed.function.slug} without making it live; preview at ${deployed.deployment.preview_url}. Make it live with: dexto cloud api POST /v1/functions/${deployed.function.id}/deployments/${deployed.deployment.id}/promote${key}`
        );
    },
};

const SITE_COLUMNS: readonly Column<z.output<typeof SiteSchema>>[] = [
    { header: 'id', value: (site) => site.id },
    { header: 'slug', value: (site) => site.slug },
    { header: 'visibility', value: (site) => site.visibility },
    { header: 'url', value: (site) => site.url },
];

const FUNCTION_COLUMNS: readonly Column<z.output<typeof FunctionSchema>>[] = [
    { header: 'id', value: (deployed) => deployed.id },
    { header: 'slug', value: (deployed) => deployed.slug },
    { header: 'status', value: (deployed) => deployed.status },
    { header: 'access', value: (deployed) => deployed.access },
    { header: 'url', value: (deployed) => deployed.url },
];

const listSites: Command = {
    path: ['cloud', 'sites', 'list'],
    summary: "List the Cloud project's Sites.",
    async run(context) {
        await requireLoginScopes(context, ['sites:read']);
        const page = z
            .object({ data: z.array(SiteSchema) })
            .parse(await callV1(context, 'GET', '/v1/sites', null));
        context.output.list(page, SITE_COLUMNS);
    },
};

const deleteSite: Command = {
    arguments: '<site>',
    options: YES_OPTION,
    path: ['cloud', 'sites', 'delete'],
    summary:
        'Delete a Site of the Cloud project, by id or slug, with its deployments and data; its slug is free again. Asks first.',
    async run(context, input) {
        // The Site is found by listing, which takes sites:read, before it is deleted.
        await requireLoginScopes(context, ['sites:read', 'sites:write', 'cloud:write']);
        const wanted = argument(input, 0, 'site');
        const sites = z
            .object({ data: z.array(SiteSchema) })
            .parse(await callV1(context, 'GET', '/v1/sites', null)).data;
        const site = sites.find((each) => each.id === wanted || each.slug === wanted);
        if (site === undefined)
            throw new CommandFailure(
                'not_found',
                `The Cloud project has no Site ${wanted}.`,
                'dexto cloud sites list'
            );
        await requireConsent(
            context,
            flag(input, 'yes'),
            `This deletes ${site.slug} (${site.url}) with its deployments and data. It can't be undone.`
        );
        await callV1(context, 'DELETE', `/v1/sites/${encodeURIComponent(site.id)}`, null);
        context.output.result(
            { deleted: true, id: site.id, slug: site.slug },
            `Deleted ${site.slug}. Its slug is free to deploy again.`
        );
    },
};

const listFunctions: Command = {
    path: ['cloud', 'functions', 'list'],
    summary: "List the Cloud project's Functions.",
    async run(context) {
        await requireLoginScopes(context, ['functions:read']);
        const page = z
            .object({ data: z.array(FunctionSchema) })
            .parse(await callV1(context, 'GET', '/v1/functions', null));
        context.output.list(page, FUNCTION_COLUMNS);
    },
};

/**
 * A person's sign-in needs the kind's permission, and to deploy also `cloud:write`, which the API
 * checks first; asking for every missing one at once lets a single sign-in cover the command. A
 * deploy spends credits, so running one is asking for `cloud:write`. At a terminal the CLI then
 * offers to sign in again for them. A key's permissions are checked by the API.
 */
export async function requireLoginScopes(
    context: CommandContext,
    scopes: readonly string[]
): Promise<void> {
    const connection = await context.connection();
    if (connection.kind !== 'oauth') return;
    const missing = scopes.filter((scope) => !connection.login.scopes.includes(scope));
    if (missing.length === 0) return;
    throw new MissingScopeFailure(
        context,
        missing.join(','),
        missing.length === 1
            ? `This needs the ${missing[0]} permission, which your sign-in lacks.`
            : `This needs the ${missing.join(' and ')} permissions, which your sign-in lacks.`
    );
}

function deployQuery(
    input: Parameters<Command['run']>[1],
    extra: Record<string, string>
): URLSearchParams {
    const provider = stringOption(input, 'provider');
    if (provider !== undefined && !PROVIDERS.some((each) => each === provider))
        throw new UsageError(`--provider must be ${PROVIDERS.join(' or ')}.`);
    return new URLSearchParams({
        ...extra,
        promote: flag(input, 'no-promote') ? 'false' : 'true',
        ...(provider === undefined ? {} : { provider }),
    });
}

/**
 * Runs the project's own packer, `.dexto/pack.mjs`, or its `pack` script when it has none, into a
 * temporary file, and returns the deploy request it wrote once it is the kind asked for.
 */
async function pack(context: CommandContext, dir: string | undefined, kind: Kind): Promise<string> {
    const projectDir = path.resolve(dir ?? '.');
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dexto-pack-'));
    const outputPath = path.join(outputDir, 'deploy-request.json');
    try {
        const ownPacker = await exists(path.join(projectDir, PACKER));
        const [command, args] = ownPacker
            ? ['node', [PACKER, '.', '--out', outputPath]]
            : ['pnpm', ['run', 'pack', '.', '--out', outputPath]];
        context.output.note(`Packing ${projectDir} with ${ownPacker ? PACKER : 'pnpm run pack'}…`);
        const packed = await context.runtime.runProcess(command, args, { cwd: projectDir });
        if (packed.exitCode !== 0)
            throw new CommandFailure(
                'invalid_input',
                `Packing failed:\n${packed.output.trim()}`,
                null
            );
        const text = await readFile(outputPath, 'utf8').catch(() => {
            throw new CommandFailure(
                'failed',
                `The packer wrote no deploy request to ${outputPath}.`,
                null
            );
        });
        const packedKind = packageKind(text);
        if (packedKind !== kind)
            throw new UsageError(
                `${projectDir} packs a ${packedKind}. Deploy it with dexto cloud ${packedKind}s deploy.`
            );
        return text;
    } finally {
        await rm(outputDir, { force: true, recursive: true });
    }
}

/** A Site's deploy request has pages (`assets`); a Function's has none. */
function packageKind(text: string): Kind {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && 'assets' in parsed
        ? 'site'
        : 'function';
}

async function exists(file: string): Promise<boolean> {
    try {
        await access(file);
        return true;
    } catch {
        return false;
    }
}

export const deployCommands: readonly Command[] = [
    deploySite,
    listSites,
    deleteSite,
    deployFunction,
    listFunctions,
];
