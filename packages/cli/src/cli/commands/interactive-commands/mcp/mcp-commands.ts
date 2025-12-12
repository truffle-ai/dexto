/**
 * MCP Commands Module
 *
 * Handles all MCP (Model Context Protocol) server management commands.
 * Provides functionality to list, add, remove, and manage MCP servers.
 */

import chalk from 'chalk';
import type { DextoAgent } from '@dexto/core';
import { CommandDefinition, CommandHandlerResult, CommandContext } from '../command-parser.js';
import { formatForInkCli } from '../utils/format-output.js';
import {
    parseStdioArgs,
    parseHttpArgs,
    parseSseArgs,
    showMcpAddHelp,
    validateAndShowErrors,
} from './mcp-add-utils.js';

/**
 * Handler for /mcp add stdio command
 */
async function handleMcpAddStdio(
    args: string[],
    agent: DextoAgent,
    _ctx: CommandContext
): Promise<boolean> {
    const { serverName, config, errors } = parseStdioArgs(args);

    if (errors.length > 0) {
        console.log(chalk.red('❌ Invalid arguments:'));
        for (const error of errors) {
            console.log(chalk.red(`   ${error}`));
        }
        return true;
    }

    // Get existing server names for validation
    const existingServers = Array.from(agent.getMcpClients().keys());

    if (!validateAndShowErrors(serverName, config, existingServers)) {
        return true;
    }

    try {
        await agent.addMcpServer(serverName, config);
        console.log(chalk.green(`✅ STDIO MCP server '${serverName}' added successfully`));
        console.log(chalk.dim(`   Command: ${config.command} ${config.args?.join(' ') ?? ''}`));
        console.log(chalk.dim(`   Connection mode: ${config.connectionMode}`));
    } catch (error) {
        agent.logger.error(
            `Failed to add STDIO MCP server '${serverName}': ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return true;
}

/**
 * Handler for /mcp add http command
 */
async function handleMcpAddHttp(
    args: string[],
    agent: DextoAgent,
    _ctx: CommandContext
): Promise<boolean> {
    const { serverName, config, errors } = parseHttpArgs(args);

    if (errors.length > 0) {
        console.log(chalk.red('❌ Invalid arguments:'));
        for (const error of errors) {
            console.log(chalk.red(`   ${error}`));
        }
        return true;
    }

    // Get existing server names for validation
    const existingServers = Array.from(agent.getMcpClients().keys());

    if (!validateAndShowErrors(serverName, config, existingServers)) {
        return true;
    }

    try {
        await agent.addMcpServer(serverName, config);
        console.log(chalk.green(`✅ HTTP MCP server '${serverName}' added successfully`));
        console.log(chalk.dim(`   URL: ${config.url}`));
        if (config.headers && Object.keys(config.headers).length > 0) {
            console.log(chalk.dim(`   Headers: ${Object.keys(config.headers).join(', ')}`));
        }
        console.log(chalk.dim(`   Connection mode: ${config.connectionMode}`));
    } catch (error) {
        agent.logger.error(
            `Failed to add HTTP MCP server '${serverName}': ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return true;
}

/**
 * Handler for /mcp add sse command
 */
async function handleMcpAddSse(
    args: string[],
    agent: DextoAgent,
    _ctx: CommandContext
): Promise<boolean> {
    const { serverName, config, errors } = parseSseArgs(args);

    if (errors.length > 0) {
        console.log(chalk.red('❌ Invalid arguments:'));
        for (const error of errors) {
            console.log(chalk.red(`   ${error}`));
        }
        return true;
    }

    // Get existing server names for validation
    const existingServers = Array.from(agent.getMcpClients().keys());

    if (!validateAndShowErrors(serverName, config, existingServers)) {
        return true;
    }

    try {
        await agent.addMcpServer(serverName, config);
        console.log(chalk.green(`✅ SSE MCP server '${serverName}' added successfully`));
        console.log(chalk.dim(`   URL: ${config.url}`));
        if (config.headers && Object.keys(config.headers).length > 0) {
            console.log(chalk.dim(`   Headers: ${Object.keys(config.headers).join(', ')}`));
        }
        console.log(chalk.dim(`   Connection mode: ${config.connectionMode}`));
    } catch (error) {
        agent.logger.error(
            `Failed to add SSE MCP server '${serverName}': ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return true;
}

// TODO: Add preset handler when presets are implemented

export const mcpCommands: CommandDefinition = {
    name: 'mcp',
    description: 'Manage MCP servers',
    usage: '/mcp <subcommand> [args]',
    category: 'MCP Management',
    subcommands: [
        {
            name: 'list',
            description: 'List all available MCP servers',
            usage: '/mcp list',
            handler: async (
                _args: string[],
                agent: DextoAgent,
                _ctx: CommandContext
            ): Promise<boolean | string> => {
                try {
                    const clients = agent.getMcpClients();
                    const failedConnections = agent.getMcpFailedConnections();

                    if (clients.size === 0 && Object.keys(failedConnections).length === 0) {
                        const output = '📋 No MCP servers configured or connected.';
                        console.log(chalk.yellow(output));
                        return formatForInkCli(output);
                    }

                    // Build output string
                    const outputLines: string[] = ['\n🔌 MCP Servers:\n'];
                    for (const [name] of clients) {
                        outputLines.push(`✅ ${name}:`);
                        outputLines.push(`  Connected: Yes`);
                        outputLines.push('');
                    }

                    if (Object.keys(failedConnections).length > 0) {
                        outputLines.push('\n❌ Failed Connections:\n');
                        for (const [name, error] of Object.entries(failedConnections)) {
                            outputLines.push(`❌ ${name}:`);
                            outputLines.push(`  Error: ${error}`);
                        }
                    }

                    outputLines.push(
                        '💡 Use /mcp add <name> <config_json_string> to connect a new MCP server.'
                    );
                    outputLines.push('💡 Use /mcp remove <name> to disconnect an MCP server.');
                    outputLines.push('💡 Use /mcp help for detailed command descriptions.');
                    const output = outputLines.join('\n');

                    // Log for regular CLI (with chalk formatting)
                    console.log(chalk.bold.blue('\n🔌 MCP Servers:\n'));
                    for (const [name] of clients) {
                        console.log(chalk.green(`✅ ${name}:`));
                        console.log(chalk.dim(`  Connected: Yes`));
                        console.log();
                    }
                    if (Object.keys(failedConnections).length > 0) {
                        console.log(chalk.bold.red('\n❌ Failed Connections:\n'));
                        for (const [name, error] of Object.entries(failedConnections)) {
                            console.log(chalk.red(`❌ ${name}:`));
                            console.log(chalk.dim(`  Error: ${error}`));
                        }
                    }
                    console.log(
                        chalk.dim(
                            '💡 Use /mcp add <name> <config_json_string> to connect a new MCP server.'
                        )
                    );
                    console.log(
                        chalk.dim('💡 Use /mcp remove <name> to disconnect an MCP server.')
                    );
                    console.log(chalk.dim('💡 Use /mcp help for detailed command descriptions.'));

                    return formatForInkCli(output);
                } catch (error) {
                    const errorMsg = `Failed to list MCP servers: ${error instanceof Error ? error.message : String(error)}`;
                    agent.logger.error(errorMsg);
                    return formatForInkCli(`❌ ${errorMsg}`);
                }
            },
        },
        {
            name: 'add',
            description: 'Add a new MCP server',
            usage: '/mcp add <type> <name> <config...>',
            subcommands: [
                {
                    name: 'stdio',
                    description: 'Add a STDIO MCP server',
                    usage: '/mcp add stdio <name> <command> [args...] [options]',
                    handler: handleMcpAddStdio,
                },
                {
                    name: 'http',
                    description: 'Add an HTTP MCP server',
                    usage: '/mcp add http <name> <url> [options]',
                    handler: handleMcpAddHttp,
                },
                {
                    name: 'sse',
                    description: 'Add an SSE MCP server',
                    usage: '/mcp add sse <name> <url> [options]',
                    handler: handleMcpAddSse,
                },
                // TODO: Add preset subcommand when implemented
            ],
            handler: async (
                args: string[],
                agent: DextoAgent,
                ctx: CommandContext
            ): Promise<CommandHandlerResult> => {
                if (args.length === 0) {
                    showMcpAddHelp();
                    return true;
                }

                const subcommand = args[0];
                const subArgs = args.slice(1);

                const subcmd = mcpCommands.subcommands
                    ?.find((s) => s.name === 'add')
                    ?.subcommands?.find((s) => s.name === subcommand);
                if (subcmd) {
                    return subcmd.handler(subArgs, agent, ctx);
                }

                console.log(chalk.red(`❌ Unknown add subcommand: ${subcommand}`));
                showMcpAddHelp();
                return true;
            },
        },
        {
            name: 'remove',
            description: 'Remove an MCP server',
            usage: '/mcp remove <name>',
            handler: async (
                args: string[],
                agent: DextoAgent,
                _ctx: CommandContext
            ): Promise<CommandHandlerResult> => {
                if (args.length === 0) {
                    const errorMsg = '❌ Usage: /mcp remove <name>';
                    console.log(chalk.red(errorMsg));
                    return errorMsg;
                }

                const name = args[0]!;
                try {
                    await agent.removeMcpServer(name);
                    const successMsg = `✅ MCP server '${name}' removed successfully`;
                    console.log(chalk.green(successMsg));
                    return successMsg;
                } catch (error) {
                    const errorMsg = `❌ Failed to remove MCP server '${name}': ${error instanceof Error ? error.message : String(error)}`;
                    agent.logger.error(errorMsg);
                    console.log(chalk.red(errorMsg));
                    return errorMsg;
                }
            },
        },
        {
            name: 'help',
            description: 'Show detailed help for MCP commands',
            usage: '/mcp help',
            handler: async (
                _args: string[],
                _agent: DextoAgent,
                _ctx: CommandContext
            ): Promise<boolean | string> => {
                const helpText = [
                    '\n🔌 MCP Management Commands:\n',
                    'Available subcommands:',
                    '  /mcp list - List all configured MCP servers',
                    '  /mcp add <type> <name> <config...> - Add a new MCP server',
                    '  /mcp remove <name> - Remove an MCP server',
                    '  /mcp help - Show this help message',
                    '\n📦 Add MCP Servers:\n',
                    '▶️ STDIO Servers (most common):',
                    '  /mcp add stdio <name> <command> [args...] [options]',
                    '  Examples:',
                    '    /mcp add stdio music uvx truffle-ai-music-creator-mcp',
                    '    /mcp add stdio filesystem npx -y @modelcontextprotocol/server-filesystem .',
                    '    /mcp add stdio sqlite npx -y @executeautomation/database-server example.db',
                    '\n🌐 HTTP Servers:',
                    '  /mcp add http <name> <url> [options]',
                    '  Examples:',
                    '    /mcp add http remote http://localhost:8080',
                    '    /mcp add http notion https://api.notion.com --header-Authorization="Bearer token"',
                    '\n📡 SSE Servers:',
                    '  /mcp add sse <name> <url> [options]',
                    '  Examples:',
                    '    /mcp add sse events http://localhost:9000/events',
                    '\n⚙️ Options:',
                    '  --timeout=<ms>         Connection timeout (default: 30000)',
                    '  --mode=<strict|lenient> Connection mode (default: lenient)',
                    '  --env-<key>=<value>    Environment variables (stdio only)',
                    '  --header-<key>=<value> HTTP/SSE headers',
                    '\n🧹 Remove MCP Server:',
                    '  /mcp remove <server-name>',
                    '\n💡 MCP servers let you connect to external tools and services.',
                    '💡 Use /mcp add --help for detailed examples and options.\n',
                ].join('\n');

                console.log(chalk.bold.blue('\n🔌 MCP Management Commands:\n'));
                console.log(chalk.cyan('Available subcommands:'));
                console.log(`  ${chalk.yellow('/mcp list')} - List all configured MCP servers`);
                console.log(
                    `  ${chalk.yellow('/mcp add')} ${chalk.blue('<type> <name> <config...>')} - Add a new MCP server`
                );
                console.log(
                    `  ${chalk.yellow('/mcp remove')} ${chalk.blue('<name>')} - Remove an MCP server`
                );
                console.log(`  ${chalk.yellow('/mcp help')} - Show this help message`);

                console.log(chalk.yellow('\n📦 Add MCP Servers:\n'));

                console.log(chalk.magenta('▶️ STDIO Servers (most common):'));
                console.log(chalk.dim(`  /mcp add stdio <name> <command> [args...] [options]`));
                console.log(chalk.dim(`  Examples:`));
                console.log(chalk.dim(`    /mcp add stdio music uvx truffle-ai-music-creator-mcp`));
                console.log(
                    chalk.dim(
                        `    /mcp add stdio filesystem npx -y @modelcontextprotocol/server-filesystem .`
                    )
                );
                console.log(
                    chalk.dim(
                        `    /mcp add stdio sqlite npx -y @executeautomation/database-server example.db`
                    )
                );

                console.log(chalk.magenta('\n🌐 HTTP Servers:'));
                console.log(chalk.dim(`  /mcp add http <name> <url> [options]`));
                console.log(chalk.dim(`  Examples:`));
                console.log(chalk.dim(`    /mcp add http remote http://localhost:8080`));
                console.log(
                    chalk.dim(
                        `    /mcp add http notion https://api.notion.com --header-Authorization="Bearer token"`
                    )
                );

                console.log(chalk.magenta('\n📡 SSE Servers:'));
                console.log(chalk.dim(`  /mcp add sse <name> <url> [options]`));
                console.log(chalk.dim(`  Examples:`));
                console.log(chalk.dim(`    /mcp add sse events http://localhost:9000/events`));

                // TODO: Add preset documentation when implemented

                console.log(chalk.yellow('\n⚙️ Options:'));
                console.log(
                    chalk.dim(`  --timeout=<ms>         Connection timeout (default: 30000)`)
                );
                console.log(
                    chalk.dim(`  --mode=<strict|lenient> Connection mode (default: lenient)`)
                );
                console.log(
                    chalk.dim(`  --env-<key>=<value>    Environment variables (stdio only)`)
                );
                console.log(chalk.dim(`  --header-<key>=<value> HTTP/SSE headers`));

                console.log(chalk.yellow('\n🧹 Remove MCP Server:'));
                console.log(chalk.dim(`  /mcp remove <server-name>`));

                console.log(
                    chalk.dim(
                        '\n💡 MCP servers let you connect to external tools and services.\n💡 Use /mcp add --help for detailed examples and options.\n'
                    )
                );

                return helpText;
            },
        },
    ],
    handler: async (
        args: string[],
        agent: DextoAgent,
        ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        if (args.length === 0) {
            const helpSubcommand = mcpCommands.subcommands?.find((s) => s.name === 'help');
            if (helpSubcommand) {
                return helpSubcommand.handler([], agent, ctx);
            }
            return true;
        }

        const subcommand = args[0];
        const subArgs = args.slice(1);
        const subcmd = mcpCommands.subcommands?.find((s) => s.name === subcommand);

        if (subcmd) {
            return subcmd.handler(subArgs, agent, ctx);
        }

        console.log(chalk.red(`❌ Unknown MCP subcommand: ${subcommand}`));
        console.log(chalk.dim('Available subcommands: list, add, remove, help'));
        console.log(chalk.dim('💡 Use /mcp help for detailed command descriptions.\n'));
        return true;
    },
};
