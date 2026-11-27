// Managed Function operations on the account MCP, distinct from Cloud project deployments.
import { CommandFailure, EXIT_CODES } from '../../failure.js';
import { z } from 'zod';
import {
    argument,
    choiceOption,
    flag,
    isJsonObject,
    MissingScopeFailure,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
    type OptionSpec,
} from '../command.js';
import { readPackage, uploadPackage, type PackageKind } from './apps.js';
import { requireLoginScopes } from './deploys.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

const PACKAGE: PackageKind = {
    label: 'a Function package',
    maxBytes: 25 * 1024 * 1024,
    purpose: 'function-package',
};
const DRY_RUN = {
    'dry-run': {
        type: 'boolean',
        description: 'Preview locally without sending anything to Dexto.',
    },
} as const satisfies Record<string, OptionSpec>;

const PackageRoutesSchema = z.object({
    routes: z.array(z.object({ access: z.literal('public'), pathPrefix: z.string() })),
});

function publicPathsInPackage(bytes: Uint8Array): string[] {
    let value: unknown;
    try {
        value = JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new UsageError('The Function package must be valid UTF-8 JSON with a routes list.');
    }
    const routes = PackageRoutesSchema.safeParse(value);
    if (!routes.success)
        throw new UsageError('The Function package must have a valid public routes list.');
    return routes.data.routes.map((route) => {
        const path = route.pathPrefix.trim();
        return path === '/' ? path : path.replace(/\/+$/u, '');
    });
}

const plan: Command = {
    path: ['workspace', 'functions', 'plan'],
    summary: 'Report the available providers for a Function or Site backend.',
    examples: ['dexto workspace functions plan --provider cloudflare-workers --json'],
    options: {
        provider: {
            type: 'string',
            valueName: 'PROVIDER',
            description: 'Provider to check; omit for host policy.',
        },
    },
    async run(context, input) {
        const provider = stringOption(input, 'provider');
        await requireLoginScopes(context, ['functions:read']);
        context.output.record(
            await queryWorkspaceTool(context, 'dexto_function_plan', {
                ...(provider === undefined ? {} : { provider }),
            })
        );
    },
};

const deploy: Command = {
    path: ['workspace', 'functions', 'deploy'],
    arguments: '<package>',
    summary:
        'Upload and deploy a Function package, making it the production deployment. Asks first.',
    examples: [
        'dexto workspace functions deploy ./deploy-request.json --access private --yes --json',
    ],
    options: {
        access: {
            type: 'string',
            valueName: 'private|public',
            description: 'Function access; defaults to private.',
        },
        ...DRY_RUN,
        ...YES_OPTION,
    },
    async run(context, input) {
        const file = argument(input, 0, 'package');
        const access = choiceOption(input, 'access', ['private', 'public']);
        const call = { ...(access === undefined ? {} : { access }) };
        const dryRun = flag(input, 'dry-run');
        if (!dryRun) {
            await context.connection({ pin: true });
            await requireLoginScopes(context, ['functions:write']);
        }
        const bytes = await readPackage(file, PACKAGE);
        const publicPaths = publicPathsInPackage(bytes);
        if (dryRun) {
            const message =
                'Nothing was sent, so Dexto checked nothing. The CLI read only the routes list for this preview.';
            context.output.result(
                {
                    dryRun: true,
                    checkedByDexto: false,
                    tool: 'dexto_function_deploy',
                    package: file,
                    arguments: call,
                    publicPaths,
                    message,
                },
                `Would deploy ${file} to production with ${access === 'public' ? 'public internet access' : 'private default access'}; public routes: ${JSON.stringify(publicPaths)}. ${message}`
            );
            return;
        }
        const tool = (await listWorkspaceTools(context)).find(
            (each) => each.name === 'dexto_function_deploy'
        );
        if (tool === undefined)
            throw new CommandFailure('failed', "This Dexto can't deploy Functions yet.", null);
        const agreed = await agreeToCall(
            context,
            {
                level: toolCallLevel(tool, call),
                schema: tool.inputSchema,
                title: `Deploy Function package ${file} to production with ${access === 'public' ? 'public internet access' : 'private default access'}; public routes: ${JSON.stringify(publicPaths)}`,
            },
            flag(input, 'yes')
        );
        const uploadPath = await uploadPackage(context, bytes, PACKAGE);
        context.output.record(
            await queryWorkspaceTool(context, 'dexto_function_deploy', {
                uploadPath,
                ...call,
                ...agreed,
            })
        );
    },
};

const credential: Command = {
    path: ['workspace', 'functions', 'credential', 'configure'],
    arguments: '<function_id> <deployment_id>',
    summary:
        'Configure a declared credential; third-party secrets are entered at a secure Dexto URL.',
    examples: [
        'dexto workspace functions credential configure "$FUNCTION_ID" "$DEPLOYMENT_ID" --kind declared-secret --name API_KEY --yes --json',
    ],
    options: {
        kind: {
            type: 'string',
            valueName: 'KIND',
            description: 'dexto-api-key or declared-secret.',
        },
        name: { type: 'string', valueName: 'NAME', description: 'Name of the declared secret.' },
        ...DRY_RUN,
        ...YES_OPTION,
    },
    async run(context, input) {
        const projectId = argument(input, 0, 'function_id');
        const deploymentId = argument(input, 1, 'deployment_id');
        const kind = choiceOption(input, 'kind', ['dexto-api-key', 'declared-secret']);
        if (kind === undefined) throw new UsageError('--kind is required.');
        const name = stringOption(input, 'name');
        if (kind === 'declared-secret' && (name === undefined || name.trim().length === 0))
            throw new UsageError('--name is required for a declared secret.');
        if (kind === 'dexto-api-key' && name !== undefined)
            throw new UsageError('--name applies only to a declared secret.');
        const credential = kind === 'declared-secret' ? { kind, name } : { kind };
        try {
            const result = await write(
                context,
                input,
                'dexto_function_credential_configure',
                { projectId, deploymentId, credential },
                `Configure ${kind === 'dexto-api-key' ? 'a Dexto API key' : `declared secret ${name}`} for deployment ${deploymentId} of Function ${projectId}`
            );
            if (isJsonObject(result) && result.status === 'input_required')
                return EXIT_CODES.waiting_on_person;
        } catch (error) {
            // This operation's existing refusal names the missing deployment-key scopes in text.
            const match =
                error instanceof CommandFailure && kind === 'dexto-api-key'
                    ? /^Reconnect Dexto MCP with the deployment's required scopes: ([\w:.-]+(?:, [\w:.-]+)*)\.$/u.exec(
                          error.message
                      )
                    : null;
            if (match?.[1] !== undefined) {
                const scopes = match[1].split(', ');
                if (
                    scopes.some(
                        (scope) => scope === 'approvals:read' || scope === 'approvals:write'
                    )
                )
                    throw new CommandFailure(
                        'needs_permission',
                        `This deployment requires unavailable MCP permissions: ${scopes.join(', ')}.`,
                        null
                    );
                throw new MissingScopeFailure(
                    context,
                    scopes,
                    `This deployment needs the ${scopes.join(', ')} permissions, which your sign-in lacks.`
                );
            }
            throw error;
        }
        return 0;
    },
};

const promote: Command = {
    path: ['workspace', 'functions', 'promote'],
    arguments: '<function_id> <deployment_id>',
    summary: 'Promote a ready Function deployment to production. Asks first.',
    examples: ['dexto workspace functions promote "$FUNCTION_ID" "$DEPLOYMENT_ID" --yes --json'],
    options: { ...DRY_RUN, ...YES_OPTION },
    async run(context, input) {
        const projectId = argument(input, 0, 'function_id');
        const deploymentId = argument(input, 1, 'deployment_id');
        await write(
            context,
            input,
            'dexto_function_promote',
            { projectId, deploymentId },
            `Promote deployment ${deploymentId} of Function ${projectId}`
        );
    },
};

const removeSecret: Command = {
    path: ['workspace', 'functions', 'secret', 'delete'],
    arguments: '<function_id> <name>',
    summary: 'Delete a configured Function secret. Asks first.',
    examples: ['dexto workspace functions secret delete "$FUNCTION_ID" API_KEY --yes --json'],
    options: { ...DRY_RUN, ...YES_OPTION },
    async run(context, input) {
        const projectId = argument(input, 0, 'function_id');
        const name = argument(input, 1, 'name');
        await write(
            context,
            input,
            'dexto_function_secret_delete',
            { projectId, name },
            `Delete secret ${name} from Function ${projectId}`
        );
    },
};

async function write(
    context: CommandContext,
    input: CommandInput,
    name: string,
    call: Record<string, unknown>,
    title: string
): Promise<unknown> {
    if (flag(input, 'dry-run')) {
        const message = 'Nothing was sent, so Dexto checked nothing.';
        context.output.result(
            { dryRun: true, checkedByDexto: false, tool: name, arguments: call, message },
            `Would call ${name} with ${JSON.stringify(call)}. ${message}`
        );
        return null;
    }
    await context.connection({ pin: true });
    await requireLoginScopes(context, ['functions:write']);
    const tool = (await listWorkspaceTools(context)).find((each) => each.name === name);
    if (tool === undefined)
        throw new CommandFailure('failed', `This Dexto does not offer ${name}.`, null);
    const agreed = await agreeToCall(
        context,
        { level: toolCallLevel(tool, call), schema: tool.inputSchema, title },
        flag(input, 'yes')
    );
    const result = await queryWorkspaceTool(context, name, { ...call, ...agreed });
    context.output.record(result);
    return result;
}

export const managedFunctionCommands: readonly Command[] = [
    plan,
    deploy,
    credential,
    promote,
    removeSecret,
];
