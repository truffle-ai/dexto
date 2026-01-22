/**
 * Prompt Commands Module
 *
 * This module defines prompt management slash commands for the Dexto CLI interface.
 * These commands provide functionality for viewing and managing system prompts.
 *
 * Available Prompt Commands:
 * - /sysprompt - Display the current system prompt
 * - /prompts - List all available prompts (MCP + internal)
 * - /<prompt-name> [args] - Direct prompt execution (auto-generated for each prompt)
 */

import chalk from 'chalk';
import type { DextoAgent, PromptInfo } from '@dexto/core';
import type { CommandDefinition, CommandContext, CommandHandlerResult } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import { createSendMessageMarker, type StyledOutput } from '../../ink-cli/services/index.js';
// Avoid depending on core types to keep CLI typecheck independent of build

/**
 * Prompt management commands
 */
export const promptCommands: CommandDefinition[] = [
    {
        name: 'sysprompt',
        description: 'Display the current system prompt',
        usage: '/sysprompt',
        category: 'Prompt Management',
        handler: async (
            _args: string[],
            agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            try {
                const systemPrompt = await agent.getSystemPrompt();

                // Return styled output for ink-cli
                const styledOutput: StyledOutput = {
                    styledType: 'sysprompt',
                    styledData: { content: systemPrompt },
                    fallbackText: `System Prompt:\n${systemPrompt}`,
                };

                return styledOutput;
            } catch (error) {
                const errorMsg = `Failed to get system prompt: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'prompts',
        description: 'Browse, add, and delete prompts',
        usage: '/prompts',
        category: 'Prompt Management',
        handler: async (
            _args: string[],
            agent: DextoAgent,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            try {
                const prompts = await agent.listPrompts();
                const promptNames = Object.keys(prompts || {});

                if (promptNames.length === 0) {
                    const output = '\n⚠️  No prompts available';
                    console.log(chalk.rgb(255, 165, 0)(output));
                    return formatForInkCli(output);
                }

                // Build output string
                const outputLines: string[] = ['\n📝 Available Prompts:\n'];

                // Group by source
                const mcpPrompts: string[] = [];
                const configPrompts: string[] = [];
                const customPrompts: string[] = [];

                for (const [name, info] of Object.entries(prompts)) {
                    if (info.source === 'mcp') {
                        mcpPrompts.push(name);
                    } else if (info.source === 'config') {
                        configPrompts.push(name);
                    } else if (info.source === 'custom') {
                        customPrompts.push(name);
                    }
                }

                if (mcpPrompts.length > 0) {
                    outputLines.push('🔗 MCP Prompts:');
                    mcpPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const displayName = info.displayName || name;
                            const title =
                                info.title && info.title !== displayName ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            const args =
                                info.arguments && info.arguments.length > 0
                                    ? ` [args: ${info.arguments
                                          .map((a) => `${a.name}${a.required ? '*' : ''}`)
                                          .join(', ')}]`
                                    : '';
                            outputLines.push(`  ${displayName}${title}${desc}${args}`);
                        }
                    });
                    outputLines.push('');
                }

                if (configPrompts.length > 0) {
                    outputLines.push('📋 Config Prompts:');
                    configPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const displayName = info.displayName || name;
                            const title =
                                info.title && info.title !== displayName ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            outputLines.push(`  ${displayName}${title}${desc}`);
                        }
                    });
                    outputLines.push('');
                }

                if (customPrompts.length > 0) {
                    outputLines.push('✨ Custom Prompts:');
                    customPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const displayName = info.displayName || name;
                            const title =
                                info.title && info.title !== displayName ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            outputLines.push(`  ${displayName}${title}${desc}`);
                        }
                    });
                    outputLines.push('');
                }

                outputLines.push(`Total: ${promptNames.length} prompts`);
                const output = outputLines.join('\n');

                // Log for regular CLI (with chalk formatting)
                console.log(chalk.bold.green('\n📝 Available Prompts:\n'));
                if (mcpPrompts.length > 0) {
                    console.log(chalk.cyan('🔗 MCP Prompts:'));
                    mcpPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const displayName = info.displayName || name;
                            const title =
                                info.title && info.title !== displayName ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            const args =
                                info.arguments && info.arguments.length > 0
                                    ? ` [args: ${info.arguments
                                          .map((a) => `${a.name}${a.required ? '*' : ''}`)
                                          .join(', ')}]`
                                    : '';
                            console.log(
                                `  ${chalk.blue(displayName)}${chalk.rgb(255, 165, 0)(title)}${chalk.gray(desc)}${chalk.gray(args)}`
                            );
                        }
                    });
                    console.log();
                }
                if (configPrompts.length > 0) {
                    console.log(chalk.cyan('📋 Config Prompts:'));
                    configPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const displayName = info.displayName || name;
                            const title =
                                info.title && info.title !== displayName ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            console.log(
                                `  ${chalk.blue(displayName)}${chalk.rgb(255, 165, 0)(title)}${chalk.gray(desc)}`
                            );
                        }
                    });
                    console.log();
                }
                if (customPrompts.length > 0) {
                    console.log(chalk.greenBright('✨ Custom Prompts:'));
                    customPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const displayName = info.displayName || name;
                            const title =
                                info.title && info.title !== displayName ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            console.log(
                                `  ${chalk.blue(displayName)}${chalk.rgb(255, 165, 0)(title)}${chalk.gray(desc)}`
                            );
                        }
                    });
                    console.log();
                }
                console.log(chalk.gray(`Total: ${promptNames.length} prompts`));
                console.log(chalk.gray('💡 Use /<prompt-name> to execute a prompt directly\n'));

                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Error listing prompts: ${error instanceof Error ? error.message : String(error)}`;
                console.error(chalk.red(`❌ ${errorMsg}`));
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    // Note: /use command removed - use /<prompt-name> directly instead
    // Prompts are automatically registered as slash commands (see getDynamicPromptCommands)
];

/**
 * Create a dynamic command definition from a prompt
 * @param promptInfo The prompt metadata
 * @param hasCollision Whether this prompt's displayName collides with another
 */
function createPromptCommand(promptInfo: PromptInfo, hasCollision: boolean): CommandDefinition {
    const baseName = promptInfo.displayName || promptInfo.name;
    // Add source prefix if collision (e.g., "config:review" or "mcp:review")
    const commandName = hasCollision ? `${promptInfo.source}:${baseName}` : baseName;
    // Keep internal name for prompt resolution (e.g., "config:review" or "mcp:server1:review")
    const internalName = promptInfo.name;

    return {
        name: commandName,
        description: promptInfo.description || `Execute ${baseName} prompt`,
        usage: `/${commandName} [context]`,
        category: 'Dynamic Prompts',
        handler: async (
            args: string[],
            agent: DextoAgent,
            ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            try {
                const { argMap, context: contextString } = splitPromptArguments(args);

                if (Object.keys(argMap).length > 0) {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${commandName}`));
                    console.log(chalk.gray(`Explicit arguments: ${JSON.stringify(argMap)}`));
                } else if (contextString) {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${commandName}`));
                    console.log(
                        chalk.gray(
                            `Context: ${contextString} (LLM will extrapolate template variables)`
                        )
                    );
                } else {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${commandName}`));
                    console.log(
                        chalk.gray('No arguments provided - LLM will extrapolate from context')
                    );
                }

                // Use resolvePrompt instead of getPrompt + flattenPromptResult (matches WebUI approach)
                const resolveOptions: {
                    args?: Record<string, unknown>;
                    context?: string;
                } = {};
                if (Object.keys(argMap).length > 0) {
                    resolveOptions.args = argMap;
                }
                if (contextString) {
                    resolveOptions.context = contextString;
                }
                // Use internal name for resolution (includes prefix like "config:")
                const result = await agent.resolvePrompt(internalName, resolveOptions);

                // Apply per-prompt overrides (Phase 2 Claude Code compatibility)
                // These overrides persist for the session until explicitly cleared
                if (ctx.sessionId) {
                    // Apply model override if specified
                    if (result.model) {
                        console.log(
                            chalk.gray(`🔄 Switching model to '${result.model}' for this prompt`)
                        );
                        try {
                            await agent.switchLLM({ model: result.model }, ctx.sessionId);
                        } catch (modelError) {
                            console.log(
                                chalk.yellow(
                                    `⚠️  Failed to switch model: ${modelError instanceof Error ? modelError.message : String(modelError)}`
                                )
                            );
                        }
                    }

                    // Apply tool restrictions if specified
                    if (result.allowedTools && result.allowedTools.length > 0) {
                        console.log(
                            chalk.gray(`🔒 Restricting tools to: ${result.allowedTools.join(', ')}`)
                        );
                        agent.toolManager.setSessionToolRestrictions(
                            ctx.sessionId,
                            result.allowedTools
                        );
                    }
                }

                // Handle fork execution context - spawn isolated subagent
                if (result.context === 'fork') {
                    console.log(chalk.cyan('🔀 Forking to isolated subagent...'));

                    // Build task context from user-provided args/context
                    const taskContext = contextString || 'Execute the skill instructions.';

                    try {
                        // Generate a unique tool call ID for this fork execution
                        const toolCallId = `fork-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                        const forkResult = (await agent.toolManager.executeTool(
                            'invoke_skill',
                            { skill: internalName, taskContext },
                            toolCallId,
                            ctx.sessionId ?? undefined
                        )) as { forked?: boolean; result?: string; error?: string };

                        if (forkResult.error) {
                            const errorMsg = `❌ Fork execution failed: ${forkResult.error}`;
                            console.log(chalk.red(errorMsg));
                            return formatForInkCli(errorMsg);
                        }

                        const successMsg = forkResult.result || 'Fork execution completed.';
                        console.log(chalk.green(`\n✅ ${successMsg}`));
                        return formatForInkCli(successMsg);
                    } catch (forkError) {
                        const errorMsg = `❌ Fork execution error: ${forkError instanceof Error ? forkError.message : String(forkError)}`;
                        console.log(chalk.red(errorMsg));
                        return formatForInkCli(errorMsg);
                    }
                }

                // Convert resource URIs to @resource mentions so agent.run() can expand them
                let finalText = result.text;
                if (result.resources.length > 0) {
                    // Append resource references as @<uri> format
                    const resourceRefs = result.resources.map((uri) => `@<${uri}>`).join(' ');
                    finalText = finalText ? `${finalText}\n\n${resourceRefs}` : resourceRefs;
                }

                if (finalText.trim()) {
                    // Return the resolved text so CLI can send it through normal streaming flow
                    // This matches WebUI behavior: resolvePrompt() -> handleSend(text)
                    return createSendMessageMarker(finalText.trim());
                } else {
                    const warningMsg = `⚠️  Prompt '${commandName}' returned no content`;
                    console.log(chalk.rgb(255, 165, 0)(warningMsg));
                    return formatForInkCli(warningMsg);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                agent.logger.error(
                    `Failed to execute prompt command '${commandName}': ${errorMessage}`
                );

                const errorMsg = `❌ Error executing prompt '${commandName}': ${errorMessage}`;
                return formatForInkCli(errorMsg);
            }
        },
    };
}

/**
 * Get all dynamic prompt commands based on available prompts.
 * Handles displayName collisions by prefixing with source (e.g., config:review).
 * Filters out prompts with `userInvocable: false` as these are not intended
 * for direct user invocation via slash commands.
 */
export async function getDynamicPromptCommands(agent: DextoAgent): Promise<CommandDefinition[]> {
    try {
        const prompts = await agent.listPrompts();
        // Filter out prompts that are not user-invocable (userInvocable: false)
        // These prompts are intended for LLM auto-invocation only, not CLI slash commands
        const promptEntries = Object.entries(prompts).filter(
            ([, info]) => info.userInvocable !== false
        );

        // Build frequency map of displayNames to detect collisions
        const displayNameCounts = new Map<string, number>();
        for (const [, info] of promptEntries) {
            const displayName = info.displayName || info.name;
            displayNameCounts.set(displayName, (displayNameCounts.get(displayName) || 0) + 1);
        }

        // Create commands with conditional prefixing
        return promptEntries.map(([, info]) => {
            const displayName = info.displayName || info.name;
            const hasCollision = (displayNameCounts.get(displayName) || 0) > 1;
            return createPromptCommand(info, hasCollision);
        });
    } catch (error) {
        agent.logger.error(
            `Failed to get dynamic prompt commands: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

function splitPromptArguments(args: string[]): {
    argMap: Record<string, string>;
    context?: string | undefined;
} {
    const map: Record<string, string> = {};
    const contextParts: string[] = [];

    for (const arg of args) {
        const equalsIndex = arg.indexOf('=');
        if (equalsIndex > 0) {
            const key = arg.slice(0, equalsIndex).trim();
            const value = arg.slice(equalsIndex + 1);
            if (key.length > 0) {
                map[key] = value;
            }
        } else if (arg.trim().length > 0) {
            contextParts.push(arg);
        }
    }

    const context = contextParts.length > 0 ? contextParts.join(' ') : undefined;
    return { argMap: map, context };
}
