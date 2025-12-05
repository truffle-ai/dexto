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
        description: 'View or change log level interactively',
        usage: '/log [level]',
        category: 'System',
        aliases: [],
        handler: async (args: string[], _agent: DextoAgent): Promise<boolean | string> => {
            const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
            const level = args[0];

            if (!level) {
                // Interactive view: show current level and options
                const currentLevel = logger.getLevel();
                const logFilePath = logger.getLogFilePath();

                console.log(chalk.bold.blue('\n📊 Logging Configuration:\n'));
                console.log(`  Current level: ${chalk.green.bold(currentLevel)}`);
                if (logFilePath) {
                    console.log(`  Log file: ${chalk.cyan(logFilePath)}`);
                }
                console.log(chalk.dim('\n  Available levels (from least to most verbose):'));
                validLevels.forEach((lvl) => {
                    const isCurrent = lvl === currentLevel;
                    const marker = isCurrent ? chalk.green('▶') : ' ';
                    const levelText = isCurrent ? chalk.green.bold(lvl) : chalk.gray(lvl);
                    console.log(`  ${marker} ${levelText}`);
                });
                console.log(
                    chalk.dim('\n  💡 Use /log <level> to change level (e.g., /log debug)\n')
                );

                const output = [
                    '\n📊 Logging Configuration:',
                    `Current level: ${currentLevel}`,
                    logFilePath ? `Log file: ${logFilePath}` : '',
                    '\nAvailable levels: error, warn, info, http, verbose, debug, silly',
                    '💡 Use /log <level> to change level',
                ]
                    .filter(Boolean)
                    .join('\n');

                return formatForInkCli(output);
            }

            if (validLevels.includes(level)) {
                logger.setLevel(level);
                logger.info(`Log level set to ${level}`, null, 'green');
                console.log(chalk.green(`✅ Log level changed to: ${chalk.bold(level)}`));
                const output = `✅ Log level set to ${level}`;
                return formatForInkCli(output);
            } else {
                const errorMsg = `❌ Invalid log level: ${level}\nValid levels: ${validLevels.join(', ')}`;
                console.log(chalk.red(`❌ Invalid log level: ${chalk.bold(level)}`));
                console.log(chalk.dim(`Valid levels: ${validLevels.join(', ')}`));
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
