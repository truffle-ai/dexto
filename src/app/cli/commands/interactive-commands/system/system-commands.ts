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
import { logger } from '@core/index.js';
import type { DextoAgent } from '@core/index.js';
import type { CommandDefinition } from '../command-parser.js';

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
        handler: async (args: string[], _agent: DextoAgent) => {
            const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
            const level = args[0];

            if (!level) {
                console.log(chalk.blue(`\nCurrent log level: ${chalk.cyan(logger.getLevel())}`));
                const logFilePath = logger.getLogFilePath();
                if (logFilePath) {
                    console.log(chalk.blue(`Log file location: ${chalk.cyan(logFilePath)}`));
                }
                console.log(
                    chalk.dim('Available levels: error, warn, info, http, verbose, debug, silly')
                );
                console.log(chalk.dim('💡 Use /log [level] to set the log level'));
                return true;
            }

            if (validLevels.includes(level)) {
                logger.setLevel(level);
                logger.info(`Log level set to ${level}`, null, 'green');
            } else {
                logger.error(
                    `Invalid log level: ${level}. Valid levels are: ${validLevels.join(', ')}`
                );
            }
            return true;
        },
    },
    {
        name: 'config',
        description: 'Show current configuration',
        usage: '/config',
        category: 'System',
        handler: async (_args: string[], agent: DextoAgent) => {
            try {
                const config = agent.getEffectiveConfig();
                console.log(chalk.blue('\n⚙️  Current Configuration:\n'));

                // LLM Config
                console.log(chalk.bold('🤖 LLM:'));
                console.log(`  Provider: ${chalk.cyan(config.llm.provider)}`);
                console.log(`  Model: ${chalk.cyan(config.llm.model)}`);
                console.log(`  Router: ${chalk.cyan(config.llm.router)}`);

                // Session Config
                console.log(chalk.bold('\n💬 Sessions:'));
                console.log(
                    `  Max Sessions: ${chalk.cyan(config.sessions?.maxSessions?.toString() || 'Default')}`
                );
                console.log(
                    `  Session TTL: ${chalk.cyan(config.sessions?.sessionTTL ? `${config.sessions.sessionTTL / 1000}s` : 'Default')}`
                );

                // MCP Servers
                console.log(chalk.bold('\n🔌 MCP Servers:'));
                const servers = Object.keys(config.mcpServers || {});
                if (servers.length > 0) {
                    for (const server of servers) {
                        console.log(`  ${chalk.cyan(server)}`);
                    }
                } else {
                    console.log(chalk.dim('  No MCP servers configured'));
                }

                console.log();
            } catch (error) {
                logger.error(
                    `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            return true;
        },
    },
    {
        name: 'stats',
        description: 'Show system statistics',
        usage: '/stats',
        category: 'System',
        handler: async (_args: string[], agent: DextoAgent) => {
            try {
                console.log(chalk.blue('\n📊 System Statistics:\n'));

                // Session stats
                const sessionStats = await agent.sessionManager.getSessionStats();
                console.log(chalk.bold('💬 Sessions:'));
                console.log(
                    `  Total Sessions: ${chalk.cyan(sessionStats.totalSessions.toString())}`
                );
                console.log(`  In Memory: ${chalk.cyan(sessionStats.inMemorySessions.toString())}`);
                console.log(`  Max Allowed: ${chalk.cyan(sessionStats.maxSessions.toString())}`);

                // MCP stats
                console.log(chalk.bold('\n🔌 MCP Servers:'));
                const connectedServers = agent.getMcpClients().size;
                const failedConnections = Object.keys(agent.getMcpFailedConnections()).length;
                console.log(`  Connected: ${chalk.green(connectedServers.toString())}`);
                if (failedConnections > 0) {
                    console.log(`  Failed: ${chalk.red(failedConnections.toString())}`);
                }

                // Tools
                try {
                    const tools = await agent.getAllMcpTools();
                    console.log(
                        `  Available Tools: ${chalk.cyan(Object.keys(tools).length.toString())}`
                    );
                } catch {
                    console.log(`  Available Tools: ${chalk.dim('Unable to count')}`);
                }

                console.log();
            } catch (error) {
                logger.error(
                    `Failed to get statistics: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            return true;
        },
    },
];
