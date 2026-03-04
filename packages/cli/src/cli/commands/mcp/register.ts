import type { Command } from 'commander';
import { logger } from '@dexto/core';
import { resolveAgentPath, loadAgentConfig } from '@dexto/agent-management';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';

export interface McpCommandRegisterContext {
    program: Command;
}

export function registerMcpCommand({ program }: McpCommandRegisterContext): void {
    // For now, this mode simply aggregates and re-expose tools from configured MCP servers (no agent)
    // dexto --mode mcp will be moved to this sub-command in the future
    program
        .command('mcp')
        .description(
            'Start Dexto as an MCP server. Use --group-servers to aggregate and re-expose tools from configured MCP servers. \
        In the future, this command will expose the agent as an MCP server by default.'
        )
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
                    strict?: boolean;
                    groupServers?: boolean;
                    name: string;
                    version: string;
                }) => {
                    try {
                        const [{ createMcpTransport }, { initializeMcpToolAggregationServer }] =
                            await Promise.all([
                                import('@dexto/server'),
                                import('../../../api/mcp/tool-aggregation-handler.js'),
                            ]);

                        // Validate that --group-servers flag is provided (mandatory for now)
                        if (!options.groupServers) {
                            console.error(
                                '❌ The --group-servers flag is required. This command currently only supports aggregating and re-exposing tools from configured MCP servers.'
                            );
                            console.error('Usage: dexto mcp --group-servers');
                            safeExit('mcp', 1, 'missing-group-servers');
                        }

                        // Load and resolve config
                        // Get the global agent option from the main program
                        const globalOpts = program.opts();
                        const configPath = await resolveAgentPath(
                            globalOpts.agent,
                            globalOpts.autoInstall !== false
                        );

                        console.log(`📄 Loading Dexto config from: ${configPath}`);
                        const config = await loadAgentConfig(configPath);

                        logger.info('Validating MCP servers...');
                        // Validate that MCP servers are configured
                        if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
                            console.error(
                                '❌ No MCP servers configured. Please configure mcpServers in your config file.'
                            );
                            safeExit('mcp', 1, 'no-mcp-servers');
                        }

                        const { ServersConfigSchema } = await import('@dexto/core');
                        const validatedServers = ServersConfigSchema.parse(config.mcpServers);
                        logger.info(
                            `Validated MCP servers. Configured servers: ${Object.keys(validatedServers).join(', ')}`
                        );

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
                        await initializeMcpToolAggregationServer(
                            validatedServers,
                            mcpTransport,
                            options.name,
                            options.version,
                            strictMode
                        );

                        logger.info('MCP tool aggregation server started successfully');
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        // Write to stderr to avoid interfering with MCP protocol
                        process.stderr.write(
                            `MCP tool aggregation server startup failed: ${err}\n`
                        );
                        safeExit('mcp', 1, 'mcp-agg-failed');
                    }
                },
                { timeoutMs: 0 }
            )
        );
}
