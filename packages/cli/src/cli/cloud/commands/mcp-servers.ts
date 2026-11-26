import { requireConsent } from '../../interaction.js';
import { z } from 'zod';
import {
    choiceOption,
    flag,
    requiredOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { callWorkspaceTool } from './workspace.js';

const importServer: Command = {
    path: ['workspace', 'mcp-servers', 'import'],
    summary: 'Import one selected remote MCP server using OAuth or a saved Vault reference.',
    examples: [
        'dexto workspace mcp-servers import --source-agent codex --source-id my-server --importer-version 1 --name "My server" --auth oauth --endpoint https://example.com/mcp --yes --json',
    ],
    jsonOutput: {
        description:
            'Import result and next step, local-only status, or proposed input for --dry-run.',
        schema: z.toJSONSchema(
            z.union([
                z.object({ status: z.literal('local_only') }),
                z.object({
                    status: z.enum(['imported', 'already_imported']),
                    connectorId: z.string(),
                    connectorSlug: z.string(),
                    importProvenance: z.record(z.string(), z.unknown()),
                    next: z.enum(['authorize', 'connect']),
                    connectUrl: z.string(),
                }),
                z
                    .object({
                        sourceAgent: z.enum(['codex', 'claude_code']),
                        sourceId: z.string(),
                        importerVersion: z.string(),
                        name: z.string(),
                        server: z.record(z.string(), z.unknown()),
                    })
                    .passthrough(),
            ])
        ),
    },
    options: {
        'source-agent': {
            type: 'string',
            valueName: 'AGENT',
            description: 'Source: codex or claude_code.',
        },
        'source-id': {
            type: 'string',
            valueName: 'ID',
            description: 'Stable server identity in the source.',
        },
        'importer-version': {
            type: 'string',
            valueName: 'VERSION',
            description: 'Version of the importer.',
        },
        name: { type: 'string', valueName: 'NAME', description: 'Name for the server.' },
        auth: {
            type: 'string',
            valueName: 'KIND',
            description: 'Authentication: oauth or static.',
        },
        endpoint: {
            type: 'string',
            valueName: 'URL',
            description: 'Remote server endpoint without credentials.',
        },
        'header-name': {
            type: 'string',
            valueName: 'NAME',
            description: 'Header holding a Vault credential (static only).',
        },
        scheme: {
            type: 'string',
            valueName: 'SCHEME',
            description: 'Credential placement: raw or bearer (static only).',
        },
        'vault-ref': {
            type: 'string',
            valueName: 'REF',
            description: 'Reference to an existing Vault credential (static only).',
        },
        'source-path': {
            type: 'string',
            valueName: 'PATH',
            description: 'Source configuration path.',
        },
        'source-created-at': {
            type: 'string',
            valueName: 'TIME',
            description: 'Source creation time (ISO 8601).',
        },
        'source-updated-at': {
            type: 'string',
            valueName: 'TIME',
            description: 'Source update time (ISO 8601).',
        },
        'dry-run': { type: 'boolean', description: 'Show the proposed import without sending it.' },
        ...YES_OPTION,
    },
    async run(context, input) {
        const sourceAgent = choiceOption(input, 'source-agent', ['codex', 'claude_code']);
        if (sourceAgent === undefined) throw new UsageError('--source-agent is required.');
        const auth = choiceOption(input, 'auth', ['oauth', 'static']);
        if (auth === undefined) throw new UsageError('--auth is required.');
        const sourceId = requiredOption(input, 'source-id');
        const importerVersion = requiredOption(input, 'importer-version');
        const name = requiredOption(input, 'name');
        const endpoint = requiredOption(input, 'endpoint');
        let url: URL;
        try {
            url = new URL(endpoint);
        } catch {
            throw new UsageError(
                '--endpoint must be a URL without credentials, query or fragment.'
            );
        }
        if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
            throw new UsageError(
                '--endpoint must be a URL without credentials, query or fragment.'
            );
        const headerName = stringOption(input, 'header-name');
        const scheme = choiceOption(input, 'scheme', ['raw', 'bearer']);
        const vaultRef = stringOption(input, 'vault-ref');
        let server;
        if (auth === 'static') {
            if (headerName === undefined || scheme === undefined || vaultRef === undefined)
                throw new UsageError(
                    'Static authentication requires --header-name, --scheme and --vault-ref.'
                );
            if (
                !/^vault:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
                    vaultRef
                )
            )
                throw new UsageError(
                    '--vault-ref must be an existing Vault reference, not a credential value.'
                );
            server = { kind: auth, endpoint, headerName, scheme, vaultRef };
        } else {
            if (headerName !== undefined || scheme !== undefined || vaultRef !== undefined)
                throw new UsageError(
                    '--header-name, --scheme and --vault-ref are only for static authentication.'
                );
            server = { kind: auth, endpoint };
        }
        const sourcePath = stringOption(input, 'source-path');
        const sourceCreatedAt = stringOption(input, 'source-created-at');
        const sourceUpdatedAt = stringOption(input, 'source-updated-at');
        const request = {
            sourceAgent,
            sourceId,
            importerVersion,
            name,
            server,
            ...(sourcePath === undefined ? {} : { sourcePath }),
            ...(sourceCreatedAt === undefined ? {} : { sourceCreatedAt }),
            ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
        };
        if (flag(input, 'dry-run')) {
            context.output.result(request, JSON.stringify(request, null, 2));
            return;
        }
        await requireLoginScopes(context, ['connectors:import']);
        await requireConsent(
            context.output.json ? { ...context, runtime: { prompt: null } } : context,
            flag(input, 'yes'),
            `Import MCP server ${name}?`
        );
        return await callWorkspaceTool(context, 'dexto_mcp_server_import', {
            ...request,
            confirm: true,
        });
    },
};

export const mcpServerCommands: readonly Command[] = [importServer];
