/**
 * General Commands Module
 *
 * This module defines general-purpose slash commands for the Dexto CLI interface.
 * These are basic commands that don't fit into specific categories.
 *
 * Available General Commands:
 * - /help [command] - Show help information
 * - /exit, /quit, /q - Exit the CLI application
 * - /clear, /reset - Clear conversation history
 */

import chalk from 'chalk';
import { spawn } from 'child_process';
import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition, CommandHandlerResult, CommandContext } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import { CommandOutputHelper } from './utils/command-output.js';
import type { HelpStyledData, ShortcutsStyledData } from '../../ink-cli/state/types.js';
import { writeToClipboard } from '../../ink-cli/utils/clipboardUtils.js';

/**
 * Get the shell rc file path for the given shell
 */
function getShellRcFile(shell: string): string | null {
    const home = process.env.HOME;
    if (!home) return null;

    if (shell.includes('zsh')) {
        return `${home}/.zshrc`;
    } else if (shell.includes('bash')) {
        return `${home}/.bashrc`;
    }
    return null;
}

/**
 * Wrap command to source shell rc file for alias support
 * This mimics how Claude Code handles shell aliases - by sourcing the rc file
 * before executing the command, we get aliases without using -i flag.
 * We use eval to force the command to be re-parsed after sourcing, since
 * aliases are expanded at parse time, not execution time.
 */
function wrapCommandWithRcSource(command: string, shell: string): string {
    const rcFile = getShellRcFile(shell);
    if (!rcFile) {
        return command;
    }

    // Escape single quotes in the command for safe eval
    const escapedCommand = command.replace(/'/g, "'\\''");

    // Source the rc file (suppressing errors if it doesn't exist), then eval the command
    // eval forces re-parsing after sourcing, allowing aliases to expand
    // For bash, we also need to enable expand_aliases
    if (shell.includes('bash')) {
        return `source "${rcFile}" 2>/dev/null; shopt -s expand_aliases 2>/dev/null; eval '${escapedCommand}'`;
    }
    return `source "${rcFile}" 2>/dev/null; eval '${escapedCommand}'`;
}

async function executeShellCommand(
    command: string,
    cwd: string,
    timeoutMs: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        // Use user's default shell from SHELL env var, fallback to /bin/sh
        // Avoid -i (interactive) as it sets up job control which causes SIGTTIN
        // when the parent process tries to read stdin while shell runs.
        // Instead, source the shell's rc file to get aliases (similar to Claude Code).
        // Use detached: true to create a new process group, preventing the child
        // from interfering with the parent's terminal control.
        const userShell = process.env.SHELL || '/bin/sh';
        const wrappedCommand = wrapCommandWithRcSource(command, userShell);

        const child = spawn(userShell, ['-c', wrappedCommand], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
            detached: true,
        });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
            child.kill();
            resolve({ stdout, stderr: `Command timed out after ${timeoutMs}ms`, exitCode: -1 });
        }, timeoutMs);

        child.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        child.on('error', (error: Error) => {
            clearTimeout(timer);
            resolve({ stdout, stderr: error.message, exitCode: -1 });
        });

        child.on('close', (code: number | null) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code ?? -1 });
        });
    });
}

/**
 * Creates the help command with access to all commands for display
 */
export function createHelpCommand(getAllCommands: () => CommandDefinition[]): CommandDefinition {
    return {
        name: 'help',
        description: 'Show help information',
        usage: '/help',
        category: 'General',
        aliases: ['h', '?'],
        handler: async (
            _args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            const allCommands = getAllCommands();

            // Build styled data for help
            const styledData: HelpStyledData = {
                commands: allCommands.map((cmd) => ({
                    name: cmd.name,
                    description: cmd.description,
                    category: cmd.category || 'General',
                })),
            };

            // Build fallback text
            const fallbackLines: string[] = ['Available Commands:'];
            for (const cmd of allCommands) {
                fallbackLines.push(`  /${cmd.name} - ${cmd.description}`);
            }

            return CommandOutputHelper.styled('help', styledData, fallbackLines.join('\n'));
        },
    };
}

/**
 * General commands that are available across all contexts
 * Note: The help command is created separately to avoid circular dependencies
 */
export const generalCommands: CommandDefinition[] = [
    {
        name: 'shell',
        description: 'Execute shell command directly (use !command as shortcut)',
        usage: '!<command> or /shell <command>',
        category: 'General',
        handler: async (
            args: string[],
            agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            const command = args.join(' ').trim();
            if (!command) {
                return formatForInkCli('❌ No command provided. Usage: !<command>');
            }

            const cwd = process.cwd();
            agent.logger.debug(`Executing shell command: ${command}`);

            const { stdout, stderr, exitCode } = await executeShellCommand(command, cwd);

            // Build output
            const lines: string[] = [];

            if (stdout.trim()) {
                lines.push(stdout.trim());
            }
            if (stderr.trim()) {
                lines.push(chalk.yellow(stderr.trim()));
            }
            if (exitCode !== 0) {
                lines.push(chalk.red(`Exit code: ${exitCode}`));
            }

            if (lines.length === 0) {
                return formatForInkCli(chalk.gray('(no output)'));
            }

            return formatForInkCli(lines.join('\n'));
        },
    },
    {
        name: 'exit',
        description: 'Exit the CLI',
        usage: '/exit',
        category: 'General',
        aliases: ['quit', 'q'],
        handler: async (
            _args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            console.log(chalk.rgb(255, 165, 0)('Exiting AI CLI. Goodbye!'));
            process.exit(0);
        },
    },
    {
        name: 'new',
        description: 'Start a new conversation',
        usage: '/new',
        category: 'General',
        handler: async (
            _args: string[],
            agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                // Create a new session
                const newSession = await agent.createSession();
                const newSessionId = newSession.id;

                // Emit session:created to switch the CLI to the new session
                agent.agentEventBus.emit('session:created', {
                    sessionId: newSessionId,
                    switchTo: true,
                });

                return formatForInkCli(
                    `✨ New conversation started\n💡 Use /resume to see previous conversations`
                );
            } catch (error) {
                const errorMsg = `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'clear',
        description: 'Continue conversation, free up AI context window',
        usage: '/clear',
        category: 'General',
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                const { sessionId } = ctx;
                if (!sessionId) {
                    return formatForInkCli('⚠️  No active session to clear');
                }

                // Clear context window - adds a marker so filterCompacted skips prior messages
                // History stays in DB for review, but LLM won't see it
                await agent.clearContext(sessionId);

                return formatForInkCli(
                    '🧹 Context window cleared\n💡 Conversation continues - AI will not see older messages'
                );
            } catch (error) {
                const errorMsg = `Failed to clear context: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'compact',
        description: 'Compact context by summarizing older messages',
        usage: '/compact',
        category: 'General',
        aliases: ['summarize'],
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                const { sessionId } = ctx;
                if (!sessionId) {
                    return formatForInkCli('⚠️  No active session to compact');
                }

                // Compact context - generates summary and hides older messages
                // The context:compacting and context:compacted events are handled by useAgentEvents
                // which shows the compacting indicator and notification message
                const result = await agent.compactContext(sessionId);

                if (!result) {
                    return formatForInkCli(
                        '💡 Nothing to compact - history is too short or compaction is not configured.'
                    );
                }

                // Return true - notification is shown via context:compacted event handler
                return true;
            } catch (error) {
                const errorMsg = `Failed to compact context: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'context',
        description: 'Show context window usage statistics',
        usage: '/context',
        category: 'General',
        aliases: ['ctx', 'tokens'],
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                const { sessionId } = ctx;
                if (!sessionId) {
                    return formatForInkCli('⚠️  No active session');
                }

                const stats = await agent.getContextStats(sessionId);

                // Create a visual progress bar (clamped to 0-100% for display)
                const barWidth = 20;
                const displayPercent = Math.min(Math.max(stats.usagePercent, 0), 100);
                const filledWidth = Math.round((displayPercent / 100) * barWidth);
                const emptyWidth = barWidth - filledWidth;
                const progressBar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);

                // Color based on usage
                let usageColor = chalk.green;
                if (stats.usagePercent > 80) usageColor = chalk.red;
                else if (stats.usagePercent > 60) usageColor = chalk.yellow;

                // Helper to format token counts
                const formatTokens = (tokens: number): string => {
                    if (tokens >= 1000) {
                        return `${(tokens / 1000).toFixed(1)}k`;
                    }
                    return tokens.toLocaleString();
                };

                // Calculate auto compact buffer (reserved space before compaction triggers)
                // maxContextTokens already has thresholdPercent applied, so we need to derive
                // the buffer as: maxContextTokens * (1 - thresholdPercent) / thresholdPercent
                const autoCompactBuffer =
                    stats.thresholdPercent > 0 && stats.thresholdPercent < 1.0
                        ? Math.floor(
                              (stats.maxContextTokens * (1 - stats.thresholdPercent)) /
                                  stats.thresholdPercent
                          )
                        : 0;
                const bufferPercent = Math.round((1 - stats.thresholdPercent) * 100);
                const bufferLabel =
                    bufferPercent > 0
                        ? `Auto compact buffer (${bufferPercent}%)`
                        : 'Auto compact buffer';

                const totalTokenSpace = stats.maxContextTokens + autoCompactBuffer;
                const usedTokens = stats.estimatedTokens + autoCompactBuffer;

                // Helper to calculate percentage of total token space
                const pct = (tokens: number): string => {
                    const percent =
                        totalTokenSpace > 0 ? ((tokens / totalTokenSpace) * 100).toFixed(1) : '0.0';
                    return `${percent}%`;
                };

                const overflowWarning = stats.usagePercent > 100 ? ' ⚠️  OVERFLOW' : '';
                const { breakdown } = stats;

                const tokenDisplay = `~${formatTokens(usedTokens)}`;

                const breakdownLabel = chalk.dim('(estimated)');
                const lines = [
                    `📊 Context Usage`,
                    `   ${usageColor(progressBar)} ${stats.usagePercent}%${overflowWarning}`,
                    `   ${chalk.dim(stats.modelDisplayName)} · ${tokenDisplay} / ${formatTokens(totalTokenSpace)} tokens`,
                    ``,
                    `   ${chalk.cyan('Breakdown:')} ${breakdownLabel}`,
                    `   ├─ System prompt: ${formatTokens(breakdown.systemPrompt)} (${pct(breakdown.systemPrompt)})`,
                    `   ├─ Tools: ${formatTokens(breakdown.tools.total)} (${pct(breakdown.tools.total)})`,
                    `   ├─ Messages: ${formatTokens(breakdown.messages)} (${pct(breakdown.messages)})`,
                    `   └─ ${bufferLabel}: ${formatTokens(autoCompactBuffer)} (${pct(autoCompactBuffer)})`,
                    ``,
                    `   Messages: ${stats.filteredMessageCount} visible (${stats.messageCount} total)`,
                ];

                // Show pruned tool count if any
                if (stats.prunedToolCount > 0) {
                    lines.push(`   🗑️  ${stats.prunedToolCount} tool output(s) pruned`);
                }

                if (stats.hasSummary) {
                    lines.push(`   📦 Context has been compacted`);
                }

                if (stats.usagePercent > 100) {
                    lines.push(
                        `   💡 Use /compact to manually compact, or send a message to trigger auto-compaction`
                    );
                }

                return formatForInkCli(lines.join('\n'));
            } catch (error) {
                const errorMsg = `Failed to get context stats: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'copy',
        description: 'Copy the last assistant response to clipboard',
        usage: '/copy',
        category: 'General',
        aliases: ['cp'],
        handler: async (
            _args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                const { sessionId } = ctx;
                if (!sessionId) {
                    return formatForInkCli('❌ No active session');
                }

                // Get session history
                const history = await agent.getSessionHistory(sessionId);
                if (!history || history.length === 0) {
                    return formatForInkCli('❌ No messages in current session');
                }

                // Find the last assistant message
                const lastAssistantMessage = [...history]
                    .reverse()
                    .find((msg) => msg.role === 'assistant');

                if (!lastAssistantMessage) {
                    return formatForInkCli('❌ No assistant response to copy');
                }

                // Extract text content from the message
                let textContent = '';
                if (typeof lastAssistantMessage.content === 'string') {
                    textContent = lastAssistantMessage.content;
                } else if (Array.isArray(lastAssistantMessage.content)) {
                    // Handle multi-part content
                    textContent = lastAssistantMessage.content
                        .filter(
                            (part): part is { type: 'text'; text: string } => part.type === 'text'
                        )
                        .map((part) => part.text)
                        .join('\n');
                }

                if (!textContent) {
                    return formatForInkCli('❌ No text content to copy');
                }

                // Copy to clipboard
                const success = await writeToClipboard(textContent);
                if (success) {
                    const preview =
                        textContent.length > 50
                            ? textContent.substring(0, 50) + '...'
                            : textContent;
                    return formatForInkCli(
                        `📋 Copied to clipboard (${textContent.length} chars)\n${preview.replace(/\n/g, ' ')}`
                    );
                } else {
                    return formatForInkCli('❌ Failed to copy to clipboard');
                }
            } catch (error) {
                const errorMsg = `Failed to copy: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'shortcuts',
        description: 'Show keyboard shortcuts',
        usage: '/shortcuts',
        category: 'General',
        aliases: ['keys', 'hotkeys'],
        handler: async (
            _args: string[],
            _agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            const styledData: ShortcutsStyledData = {
                categories: [
                    {
                        name: 'Global',
                        shortcuts: [
                            { keys: 'Ctrl+C', description: 'Clear input, then exit (press twice)' },
                            { keys: 'Ctrl+T', description: 'Toggle task list (show/hide tasks)' },
                            { keys: 'Escape', description: 'Cancel processing / close overlay' },
                        ],
                    },
                    {
                        name: 'Input',
                        shortcuts: [
                            { keys: 'Enter', description: 'Submit message' },
                            { keys: 'Shift+Enter', description: 'New line (multi-line input)' },
                            { keys: 'Up/Down', description: 'Navigate input history' },
                            { keys: 'Ctrl+R', description: 'Search history (enter search mode)' },
                            { keys: 'Tab', description: 'Autocomplete command' },
                            { keys: 'Ctrl+U', description: 'Clear input line' },
                            { keys: 'Ctrl+W', description: 'Delete word before cursor' },
                            { keys: 'Ctrl+A', description: 'Move cursor to start' },
                            { keys: 'Ctrl+E', description: 'Move cursor to end' },
                        ],
                    },
                    {
                        name: 'History Search (after Ctrl+R)',
                        shortcuts: [
                            { keys: 'Ctrl+R', description: 'Next older match' },
                            { keys: 'Ctrl+E', description: 'Next newer match' },
                            { keys: 'Enter', description: 'Accept and exit search' },
                            { keys: 'Escape', description: 'Cancel search' },
                        ],
                    },
                    {
                        name: 'Autocomplete & Selectors',
                        shortcuts: [
                            { keys: 'Up/Down', description: 'Navigate options' },
                            { keys: 'Enter', description: 'Select / execute' },
                            { keys: 'Tab', description: 'Load command into input' },
                            { keys: 'Escape', description: 'Close overlay' },
                        ],
                    },
                    {
                        name: 'Tool Approval',
                        shortcuts: [
                            { keys: 'y', description: 'Allow once' },
                            { keys: 'a', description: 'Allow for session' },
                            { keys: 'n', description: 'Deny' },
                            { keys: 'Escape', description: 'Cancel' },
                        ],
                    },
                ],
            };

            // Build fallback text
            const fallbackLines: string[] = ['Keyboard Shortcuts:'];
            for (const category of styledData.categories) {
                fallbackLines.push(`\n${category.name}:`);
                for (const shortcut of category.shortcuts) {
                    fallbackLines.push(`  ${shortcut.keys.padEnd(14)} ${shortcut.description}`);
                }
            }

            return CommandOutputHelper.styled('shortcuts', styledData, fallbackLines.join('\n'));
        },
    },
];
