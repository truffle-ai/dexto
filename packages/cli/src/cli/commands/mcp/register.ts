import type { Command } from 'commander';
import type { StandaloneMcpResult } from './standalone.js';
import { resolve } from 'node:path';
import { registerGracefulShutdown } from '../../../utils/graceful-shutdown.js';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';

export interface McpCommandRegisterContext {
    program: Command;
}

export function registerMcpCommand({ program }: McpCommandRegisterContext): void {
    const mcp = program
        .command('mcp')
        .description(
            'Configure and call MCP servers, or expose them through a stdio aggregation gateway'
        )
        .option('--config <path>', 'MCP-only YAML configuration (otherwise use --agent)')
        .option('-s, --strict', 'Require all MCP server connections to succeed')
        .option(
            '--group-servers',
            'Aggregate and re-expose tools from configured MCP servers (required for now)'
        )
        .option('--name <n>', 'Name for the MCP server', 'dexto-tools')
        .option('--version <version>', 'Version for the MCP server', '1.0.0')
        .action(
            withAnalytics(
                'mcp',
                async (options: {
                    config?: string;
                    strict?: boolean;
                    groupServers?: boolean;
                    name: string;
                    version: string;
                }) => {
                    try {
                        // Validate that --group-servers flag is provided (mandatory for now)
                        if (!options.groupServers) {
                            console.error(
                                '❌ The --group-servers flag is required. This command currently only supports aggregating and re-exposing tools from configured MCP servers.'
                            );
                            console.error('Usage: dexto mcp --group-servers');
                            safeExit('mcp', 1, 'missing-group-servers');
                            return;
                        }

                        const { logger, ServersConfigSchema } = await import('@dexto/core');
                        let servers;
                        if (options.config) {
                            const { loadStandaloneMcpConfiguration } = await import(
                                './standalone.js'
                            );
                            servers = (
                                await loadStandaloneMcpConfiguration(resolve(options.config), false)
                            ).servers;
                        } else {
                            const { resolveAgentPath, loadAgentConfig } = await import(
                                '@dexto/agent-management'
                            );
                            const globalOpts = program.opts();
                            const configPath = await resolveAgentPath(
                                globalOpts.agent,
                                globalOpts.autoInstall !== false
                            );
                            servers = (await loadAgentConfig(configPath)).mcpServers;
                        }
                        if (!servers || Object.keys(servers).length === 0) {
                            process.stderr.write(
                                'No MCP servers configured. Add a server or choose --config.\n'
                            );
                            safeExit('mcp', 1, 'no-mcp-servers');
                            return;
                        }

                        const validatedServers = ServersConfigSchema.parse(servers);
                        logger.info(
                            `Validated MCP servers. Configured servers: ${Object.keys(validatedServers).join(', ')}`
                        );

                        const [{ createMcpTransport }, { initializeMcpToolAggregationServer }] =
                            await Promise.all([
                                import('@dexto/server'),
                                import('../../../api/mcp/tool-aggregation-handler.js'),
                            ]);

                        // Logs are already redirected to file by default to prevent interference with stdio transport
                        const currentLogPath = logger.getLogFilePath();
                        logger.info(
                            `MCP mode using log file: ${currentLogPath || 'default .dexto location'}`
                        );

                        logger.info(
                            `Starting MCP tool aggregation server: ${options.name} v${options.version}`
                        );

                        // Create stdio transport for MCP tool aggregation
                        const mcpTransport = await createMcpTransport('stdio');
                        const strictMode = options.strict ?? false;
                        // Initialize tool aggregation server
                        const owner = await initializeMcpToolAggregationServer(
                            validatedServers,
                            mcpTransport,
                            options.name,
                            options.version,
                            strictMode
                        );

                        const dispose = registerGracefulShutdown(() => ({
                            stop: async () => {
                                try {
                                    await owner.close();
                                } catch {
                                    throw new Error('MCP shutdown failed');
                                }
                            },
                        }));
                        const closeOnEnd = () => {
                            void owner.close().catch(() => {
                                process.stderr.write('MCP shutdown failed.\n');
                                process.exitCode = 1;
                            });
                        };
                        process.stdin.once('end', closeOnEnd);
                        const previousClose = owner.server.onclose;
                        owner.server.onclose = () => {
                            try {
                                previousClose?.();
                            } finally {
                                dispose();
                                process.stdin.off('end', closeOnEnd);
                            }
                        };
                        logger.info('MCP tool aggregation server started successfully');
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        // Write to stderr to avoid interfering with MCP protocol
                        process.stderr.write(
                            'MCP tool aggregation server startup failed. Check configuration, credentials and server availability.\n'
                        );
                        safeExit('mcp', 1, 'mcp-agg-failed');
                    }
                },
                { timeoutMs: 0 }
            )
        );
    mcp.hook('preAction', (_, actionCommand) => {
        if (actionCommand === mcp || actionCommand.getOptionValueSource('config') !== 'default')
            return;
        const parentConfig = mcp.opts<{ config?: string }>().config;
        if (parentConfig !== undefined)
            actionCommand.setOptionValueWithSource('config', parentConfig, 'implied');
    });
    const list = mcp.command('list').description('List configured MCP servers without connecting');
    list.option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml').option(
        '--json',
        'Emit machine-readable JSON'
    );
    list.action(async (options: { config: string; json?: boolean }) => {
        const { runStandaloneMcp } = await import('./standalone.js');
        const result = await runStandaloneMcp({ command: 'list' }, options);
        printStandaloneResult(result, options.json);
    });

    const connect = mcp
        .command('connect <server>')
        .description('Probe a server connection, then close it');
    connect
        .option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON');
    connect.action(async (server: string, options: { config: string; json?: boolean }) => {
        const { runStandaloneMcp } = await import('./standalone.js');
        const result = await runStandaloneMcp({ command: 'connect', server }, options);
        printStandaloneResult(result, options.json);
    });

    const call = mcp
        .command('call <server> <tool>')
        .description('Call an explicitly selected upstream MCP tool, then close the connection');
    call.option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON')
        .option('--arguments <json>', 'Tool arguments as a JSON object', '{}');
    call.action(
        async (
            server: string,
            tool: string,
            options: { config: string; json?: boolean; arguments: string }
        ) => {
            const { runStandaloneMcp } = await import('./standalone.js');
            const result = await runStandaloneMcp(
                { command: 'call', server, tool, argumentsJson: options.arguments },
                options
            );
            printStandaloneResult(result, options.json);
        }
    );

    const tools = mcp.command('tools <server>').description('List upstream MCP tools and schemas');
    tools
        .option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON');
    tools.action(async (server: string, options: { config: string; json?: boolean }) => {
        const { runStandaloneMcp } = await import('./standalone.js');
        const result = await runStandaloneMcp({ command: 'tools', server }, options);
        printStandaloneResult(result, options.json);
    });

    const resources = mcp
        .command('resources <server>')
        .description('List upstream MCP resource metadata');
    resources
        .option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON');
    resources.action(async (server: string, options: { config: string; json?: boolean }) => {
        const { runStandaloneMcp } = await import('./standalone.js');
        const result = await runStandaloneMcp({ command: 'resources', server }, options);
        printStandaloneResult(result, options.json);
    });

    const readResource = mcp
        .command('read-resource <server> <uri>')
        .description('Read an exact upstream MCP resource, then close the connection');
    readResource
        .option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON');
    readResource.action(
        async (server: string, uri: string, options: { config: string; json?: boolean }) => {
            const { runStandaloneMcp } = await import('./standalone.js');
            const result = await runStandaloneMcp(
                { command: 'read-resource', server, uri },
                options
            );
            printStandaloneResult(result, options.json);
        }
    );

    const prompts = mcp
        .command('prompts <server>')
        .description('List upstream MCP prompt metadata');
    prompts
        .option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON');
    prompts.action(async (server: string, options: { config: string; json?: boolean }) => {
        const { runStandaloneMcp } = await import('./standalone.js');
        const result = await runStandaloneMcp({ command: 'prompts', server }, options);
        printStandaloneResult(result, options.json);
    });

    const getPrompt = mcp
        .command('get-prompt <server> <prompt>')
        .description('Render an exact upstream MCP prompt, then close the connection');
    getPrompt
        .option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON')
        .option('--arguments <json>', 'Prompt arguments as a JSON object of strings', '{}');
    getPrompt.action(
        async (
            server: string,
            prompt: string,
            options: { config: string; json?: boolean; arguments: string }
        ) => {
            const { runStandaloneMcp } = await import('./standalone.js');
            const result = await runStandaloneMcp(
                { command: 'get-prompt', server, prompt, argumentsJson: options.arguments },
                options
            );
            printStandaloneResult(result, options.json);
        }
    );

    const add = mcp.command('add <server>').description('Add MCP server configuration');
    add.option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON')
        .option('--server-config <json>', 'Server configuration as a JSON object')
        .option('--transport <type>', 'stdio, http or sse (inferred from command or URL)')
        .option('--command <executable>', 'Local stdio server executable')
        .option(
            '--arg <value>',
            'Server argument (repeat; use --arg=--flag for option arguments)',
            appendOption
        )
        .option('--env <NAME=VALUE>', 'Server environment assignment (repeat)', appendOption)
        .option('--url <url>', 'Remote MCP endpoint')
        .option('--header <NAME=VALUE>', 'Remote request header (repeat)', appendOption)
        .option('--replace', 'Replace an existing server');
    add.action(
        async (
            server: string,
            options: import('./standalone.js').McpAddOptions & {
                config: string;
                json?: boolean;
                replace?: boolean;
            }
        ) => {
            const { runStandaloneMcp, serverConfigurationFromOptions } = await import(
                './standalone.js'
            );
            let result;
            try {
                result = await runStandaloneMcp(
                    {
                        command: 'add',
                        server,
                        serverConfig: serverConfigurationFromOptions(options),
                        ...(options.replace ? { replace: true } : {}),
                    },
                    options
                );
            } catch {
                result = {
                    exitCode: 2,
                    output: {
                        error: {
                            code: 'invalid_setup_options',
                            message:
                                'Use --command with --arg/--env, --url with --header, or --server-config by itself.',
                        },
                    },
                };
            }
            printStandaloneResult(result, options.json);
        }
    );
    const remove = mcp.command('remove <server>').description('Remove configured MCP server');
    remove
        .option('--config <path>', 'MCP-only YAML configuration', '.dexto/mcp.yml')
        .option('--json', 'Emit machine-readable JSON');
    remove.action(async (server: string, options: { config: string; json?: boolean }) => {
        const { runStandaloneMcp } = await import('./standalone.js');
        const result = await runStandaloneMcp({ command: 'remove', server }, options);
        printStandaloneResult(result, options.json);
    });
}

function appendOption(value: string, previous: string[] = []): string[] {
    return [...previous, value];
}

function printStandaloneResult(result: StandaloneMcpResult, compact: boolean | undefined): void {
    process.stdout.write(JSON.stringify(result.output, null, compact ? undefined : 2) + '\n');
    process.exitCode = result.exitCode;
}
