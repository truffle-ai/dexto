/**
 * System Commands Module
 *
 * This module defines system-level slash commands for the Dexto CLI interface.
 * These commands provide system configuration, logging, and statistics functionality.
 *
 * Available System Commands:
 * - /log [level] - Set or view log level
 * - /config - Show current configuration
 * - /stats - Show system statistics
 */

import chalk from 'chalk';
import { logger, type DextoAgent } from '@dexto/core';
import type { CommandDefinition } from '../command-parser.js';
import { formatForInkCli } from '../utils/format-output.js';

/**
 * System commands for configuration and monitoring
 */
export const systemCommands: CommandDefinition[] = [
    {
        name: 'log',
        description: `Set or view log level. Available levels: ${chalk.cyan('error')}, ${chalk.cyan('warn')}, ${chalk.cyan('info')}, ${chalk.cyan('http')}, ${chalk.cyan('verbose')}, ${chalk.cyan('debug')}, ${chalk.cyan('silly')}.`,
        usage: '/log [level]',
        category: 'System',
        aliases: [],
        handler: async (args: string[], _agent: DextoAgent): Promise<boolean | string> => {
            const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
            const level = args[0];

            if (!level) {
                const output = [
                    `\nCurrent log level: ${logger.getLevel()}`,
                    logger.getLogFilePath() ? `Log file location: ${logger.getLogFilePath()}` : '',
                    'Available levels: error, warn, info, http, verbose, debug, silly',
                    '💡 Use /log [level] to set the log level',
                ]
                    .filter(Boolean)
                    .join('\n');

                console.log(chalk.blue(`\nCurrent log level: ${chalk.cyan(logger.getLevel())}`));
                const logFilePath = logger.getLogFilePath();
                if (logFilePath) {
                    console.log(chalk.blue(`Log file location: ${chalk.cyan(logFilePath)}`));
                }
                console.log(
                    chalk.dim('Available levels: error, warn, info, http, verbose, debug, silly')
                );
                console.log(chalk.dim('💡 Use /log [level] to set the log level'));
                return formatForInkCli(output);
            }

            if (validLevels.includes(level)) {
                logger.setLevel(level);
                logger.info(`Log level set to ${level}`, null, 'green');
                const output = `✅ Log level set to ${level}`;
                return formatForInkCli(output);
            } else {
                const errorMsg = `❌ Invalid log level: ${level}. Valid levels are: ${validLevels.join(', ')}`;
                logger.error(errorMsg);
                return formatForInkCli(errorMsg);
            }
        },
    },
    {
        name: 'config',
        description: 'Show current configuration',
        usage: '/config',
        category: 'System',
        handler: async (_args: string[], agent: DextoAgent): Promise<boolean | string> => {
            try {
                const config = agent.getEffectiveConfig();

                // Build output string
                const outputLines: string[] = ['\n⚙️  Current Configuration:\n'];

                // LLM Config
                outputLines.push('🤖 LLM:');
                outputLines.push(`  Provider: ${config.llm.provider}`);
                outputLines.push(`  Model: ${config.llm.model}`);
                outputLines.push(`  Router: ${config.llm.router}`);

                // Session Config
                outputLines.push('\n💬 Sessions:');
                outputLines.push(
                    `  Max Sessions: ${config.sessions?.maxSessions?.toString() || 'Default'}`
                );
                outputLines.push(
                    `  Session TTL: ${config.sessions?.sessionTTL ? `${config.sessions.sessionTTL / 1000}s` : 'Default'}`
                );

                // MCP Servers
                outputLines.push('\n🔌 MCP Servers:');
                const servers = Object.keys(config.mcpServers || {});
                if (servers.length > 0) {
                    for (const server of servers) {
                        outputLines.push(`  ${server}`);
                    }
                } else {
                    outputLines.push('  No MCP servers configured');
                }

                const output = outputLines.join('\n') + '\n';

                // Log for regular CLI
                console.log(chalk.blue('\n⚙️  Current Configuration:\n'));
                console.log(chalk.bold('🤖 LLM:'));
                console.log(`  Provider: ${chalk.cyan(config.llm.provider)}`);
                console.log(`  Model: ${chalk.cyan(config.llm.model)}`);
                console.log(`  Router: ${chalk.cyan(config.llm.router)}`);
                console.log(chalk.bold('\n💬 Sessions:'));
                console.log(
                    `  Max Sessions: ${chalk.cyan(config.sessions?.maxSessions?.toString() || 'Default')}`
                );
                console.log(
                    `  Session TTL: ${chalk.cyan(config.sessions?.sessionTTL ? `${config.sessions.sessionTTL / 1000}s` : 'Default')}`
                );
                console.log(chalk.bold('\n🔌 MCP Servers:'));
                if (servers.length > 0) {
                    for (const server of servers) {
                        console.log(`  ${chalk.cyan(server)}`);
                    }
                } else {
                    console.log(chalk.dim('  No MCP servers configured'));
                }
                console.log();

                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'stats',
        description: 'Show system statistics',
        usage: '/stats',
        category: 'System',
        handler: async (_args: string[], agent: DextoAgent): Promise<boolean | string> => {
            try {
                // Build output string
                const outputLines: string[] = ['\n📊 System Statistics:\n'];

                // Session stats
                const sessionStats = await agent.sessionManager.getSessionStats();
                outputLines.push('💬 Sessions:');
                outputLines.push(`  Total Sessions: ${sessionStats.totalSessions.toString()}`);
                outputLines.push(`  In Memory: ${sessionStats.inMemorySessions.toString()}`);
                outputLines.push(`  Max Allowed: ${sessionStats.maxSessions.toString()}`);

                // MCP stats
                outputLines.push('\n🔌 MCP Servers:');
                const connectedServers = agent.getMcpClients().size;
                const failedConnections = Object.keys(agent.getMcpFailedConnections()).length;
                outputLines.push(`  Connected: ${connectedServers.toString()}`);
                if (failedConnections > 0) {
                    outputLines.push(`  Failed: ${failedConnections.toString()}`);
                }

                // Tools
                try {
                    const tools = await agent.getAllMcpTools();
                    outputLines.push(`  Available Tools: ${Object.keys(tools).length.toString()}`);
                } catch {
                    outputLines.push('  Available Tools: Unable to count');
                }

                const output = outputLines.join('\n') + '\n';

                // Log for regular CLI
                console.log(chalk.blue('\n📊 System Statistics:\n'));
                console.log(chalk.bold('💬 Sessions:'));
                console.log(
                    `  Total Sessions: ${chalk.cyan(sessionStats.totalSessions.toString())}`
                );
                console.log(`  In Memory: ${chalk.cyan(sessionStats.inMemorySessions.toString())}`);
                console.log(`  Max Allowed: ${chalk.cyan(sessionStats.maxSessions.toString())}`);
                console.log(chalk.bold('\n🔌 MCP Servers:'));
                console.log(`  Connected: ${chalk.green(connectedServers.toString())}`);
                if (failedConnections > 0) {
                    console.log(`  Failed: ${chalk.red(failedConnections.toString())}`);
                }
                try {
                    const tools = await agent.getAllMcpTools();
                    console.log(
                        `  Available Tools: ${chalk.cyan(Object.keys(tools).length.toString())}`
                    );
                } catch {
                    console.log(`  Available Tools: ${chalk.dim('Unable to count')}`);
                }
                console.log();

                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Failed to get statistics: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
];
