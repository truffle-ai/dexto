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
 * - /stream - Toggle streaming mode for LLM responses
 * - /reasoning - Configure reasoning display and budget tokens
 * - /sounds - Configure sound notifications (interactive)
 */
import type { DextoAgent, LogLevel } from '@dexto/core';
import {
    overlayOnlyHandler,
    type CommandDefinition,
    type CommandHandlerResult,
    type CommandContext,
} from '../command-parser.js';
import { formatForInkCli } from '../utils/format-output.js';
import { CommandOutputHelper } from '../utils/command-output.js';
import type {
    ConfigStyledData,
    LogConfigStyledData,
    StatsStyledData,
} from '../../../ink-cli/state/types.js';

const validLevels = [
    'error',
    'warn',
    'info',
    'debug',
    'silly',
] as const satisfies readonly LogLevel[];
const validLevelSet = new Set<string>(validLevels);
const isLogLevel = (value: string): value is LogLevel => validLevelSet.has(value);

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
        handler: async (
            args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            try {
                const level = args[0];

                if (!level) {
                    const currentLevel = agent.logger.getLevel();
                    const logFile = agent.logger.getLogFilePath();

                    const styledData: LogConfigStyledData = {
                        currentLevel,
                        logFile,
                        availableLevels: [...validLevels],
                    };

                    const fallbackLines = [
                        'Logging Configuration:',
                        `  Current level: ${currentLevel}`,
                        logFile ? `  Log file: ${logFile}` : '',
                        `  Available levels: ${validLevels.join(', ')}`,
                        '  Use /log <level> to change level',
                    ].filter(Boolean);

                    return CommandOutputHelper.styled(
                        'log-config',
                        styledData,
                        fallbackLines.join('\n')
                    );
                }

                if (isLogLevel(level)) {
                    await agent.setLogLevel(
                        level,
                        ctx.sessionId ? { sessionId: ctx.sessionId } : undefined
                    );
                    return formatForInkCli(`✅ Log level set to ${level}`);
                }

                const errorMsg = `❌ Invalid log level: ${level}\nValid levels: ${validLevels.join(
                    ', '
                )}`;
                return formatForInkCli(errorMsg);
            } catch (error) {
                const errorMsg = `Failed to update log level: ${
                    error instanceof Error ? error.message : String(error)
                }`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'config',
        description: 'Show current configuration',
        usage: '/config',
        category: 'System',
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            try {
                const config = agent.getEffectiveConfig();
                const servers = Object.keys(config.mcpServers || {});
                const hooksEnabled = agent.services.hookManager.getHookNames();

                const configFilePath = ctx.configFilePath ?? null;

                // Build styled data
                const styledData: ConfigStyledData = {
                    configFilePath,
                    provider: config.llm.provider,
                    model: config.llm.model,
                    maxTokens: config.llm.maxOutputTokens ?? null,
                    temperature: config.llm.temperature ?? null,
                    permissionsMode: config.permissions.mode,
                    maxSessions: config.sessions?.maxSessions?.toString() || 'Default',
                    sessionTTL: config.sessions?.sessionTTL
                        ? `${config.sessions.sessionTTL / 1000}s`
                        : 'Default',
                    mcpServers: servers,
                    promptsCount: config.prompts?.length || 0,
                    hooksEnabled,
                };

                // Build fallback text (no console.log - interferes with Ink rendering)
                const fallbackLines: string[] = [
                    'Configuration:',
                    configFilePath ? `  Config: ${configFilePath}` : '',
                    `  LLM: ${config.llm.provider} / ${config.llm.model}`,
                    `  Permissions: ${styledData.permissionsMode}`,
                    `  Sessions: max=${styledData.maxSessions}, ttl=${styledData.sessionTTL}`,
                    `  MCP Servers: ${servers.length > 0 ? servers.join(', ') : 'none'}`,
                    `  Prompts: ${styledData.promptsCount}`,
                    `  Hooks: ${hooksEnabled.length > 0 ? hooksEnabled.join(', ') : 'none'}`,
                ].filter(Boolean);

                return CommandOutputHelper.styled('config', styledData, fallbackLines.join('\n'));
            } catch (error) {
                const errorMsg = `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'stats',
        description: 'Show system statistics',
        usage: '/stats',
        category: 'System',
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            try {
                // Session stats
                const sessionStats = await agent.sessionManager.getSessionStats();

                // MCP stats
                const connectedServers = agent.getMcpClients().size;
                const failedConnections = Object.keys(agent.getMcpFailedConnections()).length;

                // Tools
                let toolCount = 0;
                try {
                    const tools = await agent.getAllMcpTools();
                    toolCount = Object.keys(tools).length;
                } catch {
                    // Ignore - toolCount stays 0
                }

                // Get token usage from current session metadata
                let tokenUsage: StatsStyledData['tokenUsage'];
                let estimatedCost: number | undefined;
                if (ctx.sessionId) {
                    const sessionMetadata = await agent.sessionManager.getSessionMetadata(
                        ctx.sessionId
                    );
                    if (sessionMetadata?.tokenUsage) {
                        tokenUsage = sessionMetadata.tokenUsage;
                    }
                    estimatedCost = sessionMetadata?.estimatedCost;
                }

                // Build styled data
                const styledData: StatsStyledData = {
                    sessions: {
                        total: sessionStats.totalSessions,
                        inMemory: sessionStats.inMemorySessions,
                        maxAllowed: sessionStats.maxSessions,
                    },
                    mcp: {
                        connected: connectedServers,
                        failed: failedConnections,
                        toolCount,
                    },
                    ...(tokenUsage && { tokenUsage }),
                    ...(estimatedCost !== undefined && { estimatedCost }),
                };

                // Build fallback text
                const fallbackLines: string[] = [
                    'System Statistics:',
                    `  Sessions: ${sessionStats.totalSessions} total, ${sessionStats.inMemorySessions} in memory`,
                    `  MCP: ${connectedServers} connected, ${toolCount} tools`,
                ];
                if (failedConnections > 0) {
                    fallbackLines.push(`  Failed connections: ${failedConnections}`);
                }
                if (tokenUsage) {
                    fallbackLines.push(
                        `  Tokens: ${tokenUsage.totalTokens} total (${tokenUsage.inputTokens} in, ${tokenUsage.outputTokens} out)`
                    );
                }

                return CommandOutputHelper.styled('stats', styledData, fallbackLines.join('\n'));
            } catch (error) {
                const errorMsg = `Failed to get statistics: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'stream',
        description: 'Toggle streaming mode for LLM responses',
        usage: '/stream',
        category: 'System',
        handler: async (
            _args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            // Overlay is handled via commandOverlays.ts mapping
            return true;
        },
    },
    {
        name: 'reasoning',
        description: 'Configure reasoning display and budget tokens',
        usage: '/reasoning',
        category: 'Model',
        handler: overlayOnlyHandler,
    },
    {
        name: 'sounds',
        description: 'Configure sound notifications',
        usage: '/sounds',
        category: 'System',
        handler: overlayOnlyHandler,
    },
];
