import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import type { ValidatedMcpServerConfig } from '@dexto/core/mcp';
import {
    StdioServerConfigSchema,
    HttpServerConfigSchema,
    SseServerConfigSchema,
    McpServerConfigSchema,
    MCPManager,
    MCPError,
} from '@dexto/core/mcp';
import { DextoLogger, DextoLogComponent } from '@dexto/core/logger';

// Configuration edits keep templates literal; Core expands them at connection time.
const literalString = z.string();
const literalMap = z.record(z.string(), literalString);
const storedServerSchema = z.discriminatedUnion('type', [
    StdioServerConfigSchema.extend({
        command: literalString.min(1),
        args: z.array(literalString).default([]),
        env: literalMap.default({}),
    }),
    HttpServerConfigSchema.extend({ url: literalString.min(1), headers: literalMap.default({}) }),
    SseServerConfigSchema.extend({ url: literalString.min(1), headers: literalMap.default({}) }),
]);
const documentSchema = z
    .object({ mcpServers: z.record(z.string(), storedServerSchema).default({}) })
    .passthrough();
type McpOperation =
    | { command: 'connect' | 'tools' | 'resources' | 'prompts'; server: string }
    | { command: 'call'; server: string; tool: string; argumentsJson: string };
export type StandaloneMcpCommand =
    | { command: 'list' }
    | McpOperation
    | { command: 'remove'; server: string }
    | { command: 'add'; server: string; serverConfig: string; replace?: boolean };
export interface StandaloneMcpOptions {
    config?: string;
}
export interface StandaloneMcpResult {
    exitCode: number;
    output: unknown;
}

export async function runStandaloneMcp(
    command: StandaloneMcpCommand,
    options: StandaloneMcpOptions
): Promise<StandaloneMcpResult> {
    if ('server' in command && command.server.trim().length === 0) {
        return {
            exitCode: 2,
            output: {
                error: { code: 'invalid_server_name', message: 'Server name must not be blank.' },
            },
        };
    }
    const configPath = resolve(options.config ?? '.dexto/mcp.yml');
    try {
        const { document, servers } = await loadStandaloneMcpConfiguration(
            configPath,
            command.command === 'add'
        );
        const config = { mcpServers: servers };
        if (command.command === 'remove') {
            if (!Object.hasOwn(config.mcpServers, command.server))
                return {
                    exitCode: 2,
                    output: {
                        error: { code: 'server_not_found', message: 'Server is not configured.' },
                    },
                };
            document.deleteIn(['mcpServers', command.server]);
            await writeFile(configPath, document.toString());
            return { exitCode: 0, output: { server: command.server, status: 'removed' } };
        }
        if (command.command === 'add') {
            let raw: unknown;
            try {
                raw = JSON.parse(command.serverConfig);
                storedServerSchema.parse(raw);
            } catch {
                return {
                    exitCode: 2,
                    output: {
                        error: {
                            code: 'invalid_server_config',
                            message: 'Server configuration must be a valid MCP server JSON object.',
                        },
                    },
                };
            }
            if (Object.hasOwn(config.mcpServers, command.server) && !command.replace)
                return {
                    exitCode: 2,
                    output: {
                        error: {
                            code: 'duplicate_server',
                            message: 'Server already configured. Use --replace to overwrite it.',
                        },
                    },
                };
            document.setIn(['mcpServers', command.server], raw);
            await mkdir(dirname(configPath), { recursive: true });
            await writeFile(configPath, document.toString(), { mode: 0o600 });
            return { exitCode: 0, output: { server: command.server, status: 'configured' } };
        }
        if (command.command !== 'list') {
            const server = config.mcpServers[command.server];
            if (!server || !Object.hasOwn(config.mcpServers, command.server))
                return {
                    exitCode: 2,
                    output: {
                        error: { code: 'server_not_found', message: 'Server is not configured.' },
                    },
                };
            if (!server.enabled)
                return {
                    exitCode: 2,
                    output: { error: { code: 'server_disabled', message: 'Server is disabled.' } },
                };
            let args: Record<string, unknown> = {};
            if (command.command === 'call') {
                try {
                    args = z
                        .record(z.string(), z.unknown())
                        .parse(JSON.parse(command.argumentsJson));
                } catch {
                    return {
                        exitCode: 2,
                        output: {
                            error: {
                                code: 'invalid_arguments',
                                message: 'Tool arguments must be a valid JSON object.',
                            },
                        },
                    };
                }
            }
            return await runMcpOperation(command, McpServerConfigSchema.parse(server), args);
        }
        return {
            exitCode: 0,
            output: {
                servers: Object.entries(config.mcpServers).map(([name, server]) => ({
                    name,
                    type: server.type,
                    enabled: server.enabled,
                    status: server.enabled ? 'configured' : 'disabled',
                })),
            },
        };
    } catch (error) {
        if (error instanceof McpConfigurationError)
            return { exitCode: 2, output: { error: { code: error.code, message: error.message } } };
        if (typeof error === 'object' && error !== null && 'code' in error)
            return {
                exitCode: 2,
                output: {
                    error: {
                        code: 'config_write_failed',
                        message: 'Cannot write MCP configuration. Check the directory permissions.',
                    },
                },
            };
        return {
            exitCode: 2,
            output: {
                error: { code: 'invalid_config', message: 'Cannot validate MCP configuration.' },
            },
        };
    }
}

class McpConfigurationError extends Error {
    constructor(
        readonly code: 'config_read_failed' | 'invalid_config',
        message: string
    ) {
        super(message);
    }
}

/** Load MCP-only YAML for direct commands or the aggregation host without agent setup. */
export async function loadStandaloneMcpConfiguration(
    path: string,
    allowMissing: boolean
): Promise<{
    document: ReturnType<typeof parseDocument>;
    servers: z.output<typeof documentSchema>['mcpServers'];
}> {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (error) {
        if (
            allowMissing &&
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
        )
            text = 'mcpServers: {}\n';
        else
            throw new McpConfigurationError(
                'config_read_failed',
                'Cannot read MCP configuration. Check --config and file permissions.'
            );
    }
    try {
        const document = parseDocument(text);
        if (document.errors.length) throw new Error('Invalid YAML');
        const config = documentSchema.parse(document.toJS());
        return { document, servers: config.mcpServers };
    } catch {
        throw new McpConfigurationError(
            'invalid_config',
            'Invalid MCP YAML or server configuration.'
        );
    }
}

async function runMcpOperation(
    command: McpOperation,
    config: ValidatedMcpServerConfig,
    args: Record<string, unknown>
): Promise<StandaloneMcpResult> {
    const logger = new DextoLogger({
        level: 'error',
        component: DextoLogComponent.MCP,
        agentId: 'mcp-cli',
        transports: [],
    });
    const manager = new MCPManager(logger);
    const server = command.server;
    let connected = false;
    let result: StandaloneMcpResult = {
        exitCode: 3,
        output: {
            server,
            error: {
                code: 'mcp_connection_failed',
                message:
                    'Cannot connect to MCP server. Check its configuration, credentials and availability.',
            },
        },
    };
    try {
        await manager.connectServer(server, config);
        connected = true;
        result = await performMcpOperation(manager, command, args, config.timeout);
    } catch (error) {
        if (connected) {
            const notFound =
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'mcp_tool_not_found';
            result = {
                exitCode: 4,
                output: {
                    server,
                    error: {
                        code: notFound ? 'mcp_tool_not_found' : 'mcp_operation_failed',
                        message: notFound
                            ? 'Tool is not advertised by the selected server.'
                            : 'MCP operation failed. Check the selected operation and its arguments.',
                    },
                },
            };
        }
    } finally {
        const cleanup = await Promise.allSettled([manager.disconnectAll()]);
        cleanup.push(...(await Promise.allSettled([logger.destroy()])));
        if (cleanup.some((item) => item.status === 'rejected') && result.exitCode === 0) {
            result = {
                exitCode: 4,
                output: {
                    server,
                    error: {
                        code: 'mcp_cleanup_failed',
                        message: 'MCP connection cleanup failed.',
                    },
                },
            };
        }
    }
    return result;
}

async function performMcpOperation(
    manager: MCPManager,
    command: McpOperation,
    args: Record<string, unknown>,
    timeout: number
): Promise<StandaloneMcpResult> {
    const server = command.server;
    switch (command.command) {
        case 'connect':
            return { exitCode: 0, output: { server, status: 'connected', connection: 'closed' } };
        case 'tools':
            return {
                exitCode: 0,
                output: { server, tools: manager.getToolDescriptors(), connection: 'closed' },
            };
        case 'resources':
            return {
                exitCode: 0,
                output: {
                    server,
                    resources: await manager.listAllResources(),
                    connection: 'closed',
                },
            };
        case 'prompts':
            return {
                exitCode: 0,
                output: { server, prompts: manager.getAllPromptMetadata(), connection: 'closed' },
            };
        case 'call': {
            const descriptor = manager
                .getToolDescriptors()
                .find(
                    (tool) =>
                        tool.identity.connectionId === server &&
                        tool.identity.toolName === command.tool
                );
            if (!descriptor) throw MCPError.toolNotFound(command.tool);
            const input = manager.validateToolInput(descriptor.name, args);
            const client = manager.getClients().get(server);
            if (!client) throw new Error('Connected MCP client missing');
            // Keep upstream names literal; manager aliases can contain the same delimiter.
            const protocol = await client.getConnectedClient();
            const result = await protocol.callTool(
                { name: command.tool, arguments: input },
                undefined,
                { timeout }
            );
            return {
                exitCode: result.isError === true ? 4 : 0,
                output: { server, tool: command.tool, result, connection: 'closed' },
            };
        }
    }
}

export interface McpAddOptions {
    serverConfig?: string;
    transport?: string;
    command?: string;
    arg?: string[];
    env?: string[];
    url?: string;
    header?: string[];
}

/** Convert CLI setup forms to literal configuration without expanding credentials. */
export function serverConfigurationFromOptions(options: McpAddOptions): string {
    const { serverConfig, transport, command, arg, env, url, header } = options;
    if (serverConfig !== undefined) {
        if ([transport, command, arg, env, url, header].some((value) => value !== undefined))
            throw new Error('Conflicting setup options');
        return serverConfig;
    }
    if (
        command !== undefined &&
        url === undefined &&
        header === undefined &&
        (transport === undefined || transport === 'stdio')
    ) {
        return JSON.stringify({
            type: 'stdio',
            command,
            args: arg ?? [],
            env: parseAssignments(env ?? []),
        });
    }
    if (
        url !== undefined &&
        command === undefined &&
        arg === undefined &&
        env === undefined &&
        (transport === undefined || transport === 'http' || transport === 'sse')
    ) {
        return JSON.stringify({
            type: transport ?? 'http',
            url,
            headers: parseAssignments(header ?? []),
        });
    }
    throw new Error('Invalid or conflicting setup options');
}

function parseAssignments(values: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const value of values) {
        const separator = value.indexOf('=');
        if (separator <= 0) throw new Error('Expected NAME=VALUE');
        const name = value.slice(0, separator);
        if (Object.hasOwn(result, name)) throw new Error('Duplicate assignment');
        Object.defineProperty(result, name, {
            value: value.slice(separator + 1),
            enumerable: true,
            configurable: true,
        });
    }
    return result;
}
