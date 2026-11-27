// `apps`: inspect the Dexto Apps your sign-in reaches and the retained data of Apps you
// uninstalled, and deploy a packaged App or check it against the installed one, over Dexto's typed
// App tools. Running, opening, installing and removing data stay with those tools
// (`workspace <app> <operation>` runs App actions).

import { CommandFailure } from '../../failure.js';

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';
import {
    argument,
    flag,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import type { Column } from '../output.js';
import { sendBytes } from '../transfer.js';
import { requireLoginScopes } from './deploys.js';
import { formatBytes } from './files.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

const SCOPES = ['apps:read'] as const;

/** A package file the CLI uploads: its upload purpose, how large it can be, and its name. */
export interface PackageKind {
    readonly label: string;
    readonly maxBytes: number;
    readonly purpose: 'app-package' | 'application-package' | 'function-package';
}
const APP_PACKAGE: PackageKind = {
    label: 'a Dexto App package',
    maxBytes: 40 * 1024 * 1024,
    purpose: 'app-package',
};

const AppSchema = z
    .object({
        actionsAvailable: z.array(z.string()),
        delivery: z.string(),
        id: z.string(),
        title: z.string(),
    })
    .passthrough();
const ListSchema = z.object({ apps: z.array(AppSchema) }).passthrough();
const ActionSchema = z
    .object({ execution: z.string(), level: z.string(), title: z.string(), toolName: z.string() })
    .passthrough();
const DetailSchema = z
    .object({
        actions: z.array(ActionSchema),
        app: z
            .object({ id: z.string(), launchUrl: z.string().optional(), title: z.string() })
            .passthrough(),
    })
    .passthrough();
const RetainedSchema = z
    .object({ appId: z.string(), dataDeletedOn: z.string(), title: z.string() })
    .passthrough();
const UninstalledSchema = z.object({ apps: z.array(RetainedSchema) }).passthrough();

type App = z.output<typeof AppSchema>;
type Action = z.output<typeof ActionSchema>;
type Retained = z.output<typeof RetainedSchema>;

const APP_COLUMNS: readonly Column<App>[] = [
    { header: 'id', value: (app) => app.id },
    { header: 'title', value: (app) => app.title },
    { header: 'delivery', value: (app) => app.delivery },
    { header: 'actions', value: (app) => String(app.actionsAvailable.length) },
];
const ACTION_COLUMNS: readonly Column<Action>[] = [
    { header: 'action', value: (action) => action.toolName },
    { header: 'title', value: (action) => action.title },
    { header: 'execution', value: (action) => action.execution },
    { header: 'level', value: (action) => action.level },
];
const RETAINED_COLUMNS: readonly Column<Retained>[] = [
    { header: 'id', value: (app) => app.appId },
    { header: 'title', value: (app) => app.title },
    { header: 'data deleted on', value: (app) => app.dataDeletedOn },
];

const list: Command = {
    path: ['apps', 'list'],
    summary: 'List the Dexto Apps available to you in this organization.',
    examples: ['dexto apps list --json'],
    async run(context) {
        await requireLoginScopes(context, SCOPES);
        const result = ListSchema.parse(await queryWorkspaceTool(context, 'dexto_apps_list', {}));
        if (context.output.json) return context.output.record(result);
        context.output.list({ data: result.apps }, APP_COLUMNS);
    },
};

const get: Command = {
    arguments: '<app_id>',
    path: ['apps', 'get'],
    summary: "Show one available App: its actions' input schemas, execution and launch URL.",
    examples: ['dexto apps get "$APP_ID" --json'],
    async run(context, input) {
        const appId = argument(input, 0, 'app_id');
        await requireLoginScopes(context, SCOPES);
        const result = DetailSchema.parse(
            await queryWorkspaceTool(context, 'dexto_app_get', { appId })
        );
        // JSON keeps the tool's whole response, input schemas included; people get the App and
        // a table of its actions.
        if (context.output.json) return context.output.record(result);
        context.output.record(result.app);
        if (result.actions.length > 0)
            context.output.list({ data: result.actions }, ACTION_COLUMNS);
    },
};

const uninstalled: Command = {
    path: ['apps', 'uninstalled'],
    summary: 'List Apps you uninstalled whose data Dexto still keeps, and when it is deleted.',
    examples: ['dexto apps uninstalled --json'],
    async run(context) {
        await requireLoginScopes(context, SCOPES);
        const result = UninstalledSchema.parse(
            await queryWorkspaceTool(context, 'dexto_apps_uninstalled_list', {})
        );
        if (context.output.json) return context.output.record(result);
        context.output.list({ data: result.apps }, RETAINED_COLUMNS);
    },
};

const PreparedSchema = z.object({
    headers: z.record(z.string(), z.string()),
    method: z.string(),
    path: z.string(),
    url: z.string(),
});
const DeployedSchema = z.object({ status: z.string() }).passthrough();
const VerifiedSchema = z.object({ matchesPackage: z.boolean(), status: z.string() }).passthrough();

const PACKAGE_ARGUMENTS = '<app_id> <package>';
const PACKAGE_HELP =
    '<package> is the deploy-request.json the dexto-apps packer writes (by default <app>/.dexto/deploy-request.json); <app_id> is the appId it names.';

const deploy: Command = {
    arguments: PACKAGE_ARGUMENTS,
    options: YES_OPTION,
    path: ['apps', 'deploy'],
    summary: `Deploy a packaged Dexto App into your Apps, installed and active. ${PACKAGE_HELP} Requires apps:write.`,
    examples: ['dexto apps deploy notes ./notes/.dexto/deploy-request.json --yes --json'],
    async run(context, input) {
        await requireLoginScopes(context, ['apps:write']);
        const appId = argument(input, 0, 'app_id');
        const bytes = await readPackage(argument(input, 1, 'package'), APP_PACKAGE);
        const tool = (await listWorkspaceTools(context)).find(
            (each) => each.name === 'dexto_app_deploy'
        );
        if (tool === undefined)
            throw new CommandFailure('failed', "This Dexto can't deploy Dexto Apps yet.", null);
        // Agreeing comes before the upload, so a refusal leaves nothing behind.
        const agreed = await agreeToCall(
            context,
            {
                level: toolCallLevel(tool, { appId }),
                schema: tool.inputSchema,
                title: `Deploy Dexto App ${appId}`,
            },
            flag(input, 'yes')
        );
        const uploadPath = await uploadPackage(context, bytes, APP_PACKAGE);
        // Dexto checks the package, then takes the upload: one upload makes one deploy.
        const value = await queryWorkspaceTool(context, 'dexto_app_deploy', {
            appId,
            uploadPath,
            ...agreed,
        });
        context.output.result(value, `Deployed ${appId}: ${DeployedSchema.parse(value).status}.`);
    },
};

const verify: Command = {
    arguments: PACKAGE_ARGUMENTS,
    path: ['apps', 'verify'],
    summary: `Check the installed Dexto App against a package without deploying it. ${PACKAGE_HELP} Requires apps:read.`,
    examples: ['dexto apps verify notes ./notes/.dexto/deploy-request.json --json'],
    async run(context, input) {
        await requireLoginScopes(context, SCOPES);
        const appId = argument(input, 0, 'app_id');
        const uploadPath = await uploadPackage(
            context,
            await readPackage(argument(input, 1, 'package'), APP_PACKAGE),
            APP_PACKAGE
        );
        // Verifying reads the upload and takes nothing; it never deploys.
        const value = await queryWorkspaceTool(context, 'dexto_app_deployment_verify', {
            appId,
            uploadPath,
        });
        const { matchesPackage, status } = VerifiedSchema.parse(value);
        context.output.result(
            value,
            matchesPackage
                ? `The installed ${appId} matches the package (${status}).`
                : `The installed ${appId} does not match the package (${status}).`
        );
    },
};

/** A package file's bytes, checked against what its upload can be. */
export async function readPackage(
    given: string,
    kind: PackageKind
): Promise<Uint8Array<ArrayBuffer>> {
    const file = path.resolve(given);
    const found = await stat(file).catch(() => null);
    if (found === null || !found.isFile())
        throw new UsageError(`${file} isn't a file. Pass the package's deploy-request.json.`);
    if (found.size > kind.maxBytes)
        throw new UsageError(
            `${file} is ${formatBytes(found.size)}; ${kind.label} can be up to ${formatBytes(kind.maxBytes)}.`
        );
    return new Uint8Array(await readFile(file));
}

/** Uploads a package for its purpose and returns the path the deploy tools take. */
export async function uploadPackage(
    context: CommandContext,
    bytes: Uint8Array<ArrayBuffer>,
    kind: PackageKind
): Promise<string> {
    const prepared = PreparedSchema.safeParse(
        await queryWorkspaceTool(context, 'dexto_upload_prepare', {
            filename: 'deploy-request.json',
            mimeType: 'application/json',
            purpose: kind.purpose,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            sizeBytes: bytes.byteLength,
        })
    );
    if (!prepared.success)
        throw new CommandFailure('failed', "Dexto didn't say where to upload the package.", null);
    const { headers, method, url } = prepared.data;
    await sendBytes(context, { headers, method, url }, new globalThis.Blob([bytes]));
    return prepared.data.path;
}

export const appCommands: readonly Command[] = [list, get, uninstalled, deploy, verify];
