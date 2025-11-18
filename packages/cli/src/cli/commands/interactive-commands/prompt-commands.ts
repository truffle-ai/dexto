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
import { logger, type DextoAgent } from '@dexto/core';
import type { PromptInfo } from '@dexto/core';
import type { CommandDefinition } from './command-parser.js';
import { getCLISessionId } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
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
        handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
            try {
                const systemPrompt = await agent.getSystemPrompt();

                const output = `\n📋 Current System Prompt:\n${'─'.repeat(80)}\n${systemPrompt}\n${'─'.repeat(80)}\n`;

                console.log(chalk.bold.green('\n📋 Current System Prompt:\n'));
                console.log(chalk.dim('─'.repeat(80)));
                console.log(systemPrompt);
                console.log(chalk.dim('─'.repeat(80)));
                console.log();

                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Failed to get system prompt: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    {
        name: 'prompts',
        description: 'List all available prompts (use /<prompt-name> to execute)',
        usage: '/prompts',
        category: 'Prompt Management',
        handler: async (_args: string[], agent: DextoAgent): Promise<boolean | string> => {
            try {
                const prompts = await agent.listPrompts();
                const promptNames = Object.keys(prompts || {});

                if (promptNames.length === 0) {
                    const output = '\n⚠️  No prompts available';
                    console.log(chalk.yellow(output));
                    return formatForInkCli(output);
                }

                // Build output string
                const outputLines: string[] = ['\n📝 Available Prompts:\n'];

                // Group by source
                const mcpPrompts: string[] = [];
                const filePrompts: string[] = [];
                const starterPrompts: string[] = [];
                const customPrompts: string[] = [];

                for (const [name, info] of Object.entries(prompts)) {
                    if (info.source === 'mcp') {
                        mcpPrompts.push(name);
                    } else if (info.source === 'file') {
                        filePrompts.push(name);
                    } else if (info.source === 'starter') {
                        starterPrompts.push(name);
                    } else if (info.source === 'custom') {
                        customPrompts.push(name);
                    }
                }

                if (mcpPrompts.length > 0) {
                    outputLines.push('🔗 MCP Prompts:');
                    mcpPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            const args =
                                info.arguments && info.arguments.length > 0
                                    ? ` [args: ${info.arguments
                                          .map((a) => `${a.name}${a.required ? '*' : ''}`)
                                          .join(', ')}]`
                                    : '';
                            outputLines.push(`  ${name}${title}${desc}${args}`);
                        }
                    });
                    outputLines.push('');
                }

                if (filePrompts.length > 0) {
                    outputLines.push('📁 File Prompts:');
                    filePrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            outputLines.push(`  ${name}${title}${desc}`);
                        }
                    });
                    outputLines.push('');
                }

                if (starterPrompts.length > 0) {
                    outputLines.push('⭐ Starter Prompts:');
                    starterPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            outputLines.push(`  ${name}${title}${desc}`);
                        }
                    });
                    outputLines.push('');
                }

                if (customPrompts.length > 0) {
                    outputLines.push('✨ Custom Prompts:');
                    customPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            outputLines.push(`  ${name}${title}${desc}`);
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
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            const args =
                                info.arguments && info.arguments.length > 0
                                    ? ` [args: ${info.arguments
                                          .map((a) => `${a.name}${a.required ? '*' : ''}`)
                                          .join(', ')}]`
                                    : '';
                            console.log(
                                `  ${chalk.blue(name)}${chalk.yellow(title)}${chalk.dim(desc)}${chalk.gray(args)}`
                            );
                        }
                    });
                    console.log();
                }
                if (filePrompts.length > 0) {
                    console.log(chalk.magenta('📁 File Prompts:'));
                    filePrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            console.log(
                                `  ${chalk.blue(name)}${chalk.yellow(title)}${chalk.dim(desc)}`
                            );
                        }
                    });
                    console.log();
                }
                if (starterPrompts.length > 0) {
                    console.log(chalk.green('⭐ Starter Prompts:'));
                    starterPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            console.log(
                                `  ${chalk.blue(name)}${chalk.yellow(title)}${chalk.dim(desc)}`
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
                            const title =
                                info.title && info.title !== name ? ` (${info.title})` : '';
                            const desc = info.description ? ` - ${info.description}` : '';
                            console.log(
                                `  ${chalk.blue(name)}${chalk.yellow(title)}${chalk.dim(desc)}`
                            );
                        }
                    });
                    console.log();
                }
                console.log(chalk.dim(`Total: ${promptNames.length} prompts`));
                console.log(chalk.dim('💡 Use /<prompt-name> to execute a prompt directly\n'));

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
 */
function createPromptCommand(promptInfo: PromptInfo): CommandDefinition {
    return {
        name: promptInfo.name,
        description: promptInfo.description || `Execute ${promptInfo.name} prompt`,
        usage: `/${promptInfo.name} [context]`,
        category: 'Dynamic Prompts',
        handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
            try {
                const { argMap, context: contextString } = splitPromptArguments(args);

                if (Object.keys(argMap).length > 0) {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${promptInfo.name}`));
                    console.log(chalk.dim(`Explicit arguments: ${JSON.stringify(argMap)}`));
                } else if (contextString) {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${promptInfo.name}`));
                    console.log(
                        chalk.dim(
                            `Context: ${contextString} (LLM will extrapolate template variables)`
                        )
                    );
                } else {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${promptInfo.name}`));
                    console.log(
                        chalk.dim('No arguments provided - LLM will extrapolate from context')
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
                const result = await agent.resolvePrompt(promptInfo.name, resolveOptions);

                // Convert resource URIs to @resource mentions so agent.run() can expand them
                let finalText = result.text;
                if (result.resources.length > 0) {
                    // Append resource references as @<uri> format
                    const resourceRefs = result.resources.map((uri) => `@<${uri}>`).join(' ');
                    finalText = finalText ? `${finalText}\n\n${resourceRefs}` : resourceRefs;
                }

                if (finalText.trim()) {
                    // agent.run() will expand @resource mentions automatically
                    // This will trigger the normal message flow in ink-cli
                    const sessionId = getCLISessionId(agent);
                    if (!sessionId) {
                        const errorMsg =
                            '❌ No active session. This should not happen in interactive mode.';
                        console.error(chalk.red(errorMsg));
                        return formatForInkCli(errorMsg);
                    }
                    await agent.run(finalText.trim(), undefined, undefined, sessionId);
                    // Return empty string to indicate command handled (ink-cli will show the message)
                    return '';
                } else {
                    const warningMsg = `⚠️  Prompt '${promptInfo.name}' returned no content`;
                    console.log(chalk.yellow(warningMsg));
                    return formatForInkCli(warningMsg);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(
                    `Failed to execute prompt command '${promptInfo.name}': ${errorMessage}`
                );

                const errorMsg = `❌ Error executing prompt '${promptInfo.name}': ${errorMessage}`;
                console.log(chalk.red(errorMsg));
                return formatForInkCli(errorMsg);
            }
        },
    };
}

/**
 * Get all dynamic prompt commands based on available prompts
 */
export async function getDynamicPromptCommands(agent: DextoAgent): Promise<CommandDefinition[]> {
    try {
        const prompts = await agent.listPrompts();
        return Object.values(prompts).map(createPromptCommand);
    } catch (error) {
        logger.error(
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
