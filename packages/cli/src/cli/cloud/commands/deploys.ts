// `cloud sites` and `cloud functions`: pack a project with its own packer (or, for a plain static
// Site, the CLI's own), deploy, list and delete.

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';

import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import {
    argument,
    flag,
    MissingScopeFailure,
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

// A Site of pages only, which the CLI packs itself. Anything more (a Function, data, visitor sign-in)
// needs the project's packer. The deploy route checks each value.
const StaticSiteConfigSchema = z
    .object({
        $schema: z.string().optional(),
        assets: z.string(),
        slug: z.string(),
        spaFallback: z.boolean().optional(),
        title: z.string(),
        visibility: z.string().optional(),
    })
    .strict();
const PackageScriptsSchema = z.object({ scripts: z.object({ pack: z.string() }) });

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
        'Pack the Site in dir (default: here) with its packer, or as static pages from dexto.json when it has none, and deploy it to the Cloud project; it goes live unless --no-promote.',
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
        missing,
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
 * Packs the project into a deploy request and returns it once it is the kind asked for. A project's
 * own packer, `.dexto/pack.mjs` or its `pack` script, runs into a temporary file; a project with
 * neither is packed here as a static Site.
 */
async function pack(context: CommandContext, dir: string | undefined, kind: Kind): Promise<string> {
    const projectDir = path.resolve(dir ?? '.');
    const packer = await projectPacker(projectDir);
    context.output.note(`Packing ${projectDir} with ${packer?.name ?? 'the static Site packer'}…`);
    const text =
        packer === null
            ? await packStaticSite(projectDir)
            : await runPacker(context, projectDir, packer);
    const packedKind = packageKind(text);
    if (packedKind !== kind)
        throw new UsageError(
            `${projectDir} packs a ${packedKind}. Deploy it with dexto cloud ${packedKind}s deploy.`
        );
    return text;
}

type Packer = { name: string; command: string; args: readonly string[] };

async function projectPacker(projectDir: string): Promise<Packer | null> {
    if (await exists(path.join(projectDir, PACKER)))
        return { name: PACKER, command: 'node', args: [PACKER, '.'] };
    const manifest = await readFile(path.join(projectDir, 'package.json'), 'utf8').catch(
        () => null
    );
    if (manifest === null) return null;
    const hasPackScript = PackageScriptsSchema.safeParse(
        parseJson(manifest, path.join(projectDir, 'package.json'))
    ).success;
    return hasPackScript
        ? { name: 'pnpm run pack', command: 'pnpm', args: ['run', 'pack', '.'] }
        : null;
}

async function runPacker(
    context: CommandContext,
    projectDir: string,
    packer: Packer
): Promise<string> {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dexto-pack-'));
    const outputPath = path.join(outputDir, 'deploy-request.json');
    try {
        const packed = await context.runtime.runProcess(
            packer.command,
            [...packer.args, '--out', outputPath],
            { cwd: projectDir }
        );
        if (packed.exitCode !== 0)
            throw new CommandFailure(
                'invalid_input',
                `Packing failed:\n${packed.output.trim()}`,
                null
            );
        return await readFile(outputPath, 'utf8').catch(() => {
            throw new CommandFailure(
                'failed',
                `The packer wrote no deploy request to ${outputPath}.`,
                null
            );
        });
    } finally {
        await rm(outputDir, { force: true, recursive: true });
    }
}

/**
 * Packs a static Site from its `dexto.json` the way the Sites packer does: every file under
 * `assets`, served from `index.html`.
 */
async function packStaticSite(projectDir: string): Promise<string> {
    const configPath = path.join(projectDir, 'dexto.json');
    const configText = await readFile(configPath, 'utf8').catch(() => {
        throw new UsageError(
            `${configPath} not found. A Site keeps its settings there: { "slug": "my-site", "title": "My site", "assets": "dist" }.`
        );
    });
    const config = StaticSiteConfigSchema.safeParse(parseJson(configText, configPath));
    if (!config.success)
        throw new UsageError(
            `${projectDir} has no packer (${PACKER} or a "pack" script in package.json), so it deploys as a static Site, whose dexto.json has only "slug", "title" and "assets" (and optionally "visibility" and "spaFallback"). For a Function, data or visitor sign-in, add ${PACKER} from the Sites skill.`
        );
    const { assets, slug, spaFallback, title, visibility } = config.data;
    const assetsDir = path.resolve(projectDir, assets);
    const fromProject = path.relative(projectDir, assetsDir);
    if (fromProject === '' || fromProject.startsWith('..') || path.isAbsolute(fromProject))
        throw new UsageError(
            '"assets" in dexto.json must name the built pages folder inside the project, such as "dist".'
        );
    const indexPath = path.join(assetsDir, 'index.html');
    const html = await readFile(indexPath, 'utf8').catch(() => {
        throw new UsageError(`${indexPath} is missing: build the Site first.`);
    });
    if (/<(?:link|script)\b[^>]*(?:href|src)\s*=\s*["']\//iu.test(html))
        throw new UsageError(
            `${assets}/index.html must use relative asset URLs (Vite base "./"); previews serve Sites under a path.`
        );
    const pages = await Promise.all(
        (await listFiles(assetsDir)).sort().map(async (file) => ({
            contentBase64: (await readFile(file)).toString('base64'),
            path: path.relative(assetsDir, file).split(path.sep).join('/'),
        }))
    );
    return JSON.stringify({
        assets: pages,
        entrypoint: 'index.html',
        runtime: { kind: 'static' },
        schemaVersion: 1,
        slug,
        spaFallback: spaFallback ?? true,
        title,
        visibility: visibility ?? 'unlisted',
    });
}

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink())
                throw new UsageError(`Built pages cannot contain symbolic links: ${file}`);
            return entry.isDirectory() ? listFiles(file) : [file];
        })
    );
    return nested.flat();
}

function parseJson(text: string, file: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        throw new UsageError(`${file} must be valid JSON.`);
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
