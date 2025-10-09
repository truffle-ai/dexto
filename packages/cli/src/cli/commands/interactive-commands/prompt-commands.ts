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
import { logger, flattenPromptResult, type DextoAgent } from '@dexto/core';
import type { PromptInfo } from '@dexto/core';
import type { CommandDefinition } from './command-parser.js';
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
        handler: async (args: string[], agent: DextoAgent): Promise<boolean> => {
            try {
                const systemPrompt = await agent.getSystemPrompt();

                console.log(chalk.bold.green('\n📋 Current System Prompt:\n'));
                console.log(chalk.dim('─'.repeat(80)));
                console.log(systemPrompt);
                console.log(chalk.dim('─'.repeat(80)));
                console.log();
            } catch (error) {
                logger.error(
                    `Failed to get system prompt: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            return true;
        },
    },
    {
        name: 'prompts',
        description: 'List all available prompts (MCP + internal)',
        usage: '/prompts',
        category: 'Prompt Management',
        handler: async (_args: string[], agent: DextoAgent): Promise<boolean> => {
            try {
                const prompts = await agent.listPrompts();
                const promptNames = Object.keys(prompts || {});

                if (promptNames.length === 0) {
                    console.log(chalk.yellow('\n⚠️  No prompts available'));
                    return true;
                }

                console.log(chalk.bold.green('\n📝 Available Prompts:\n'));

                // Group by source
                const mcpPrompts: string[] = [];
                const internalPrompts: string[] = [];
                const starterPrompts: string[] = [];
                const customPrompts: string[] = [];

                for (const [name, info] of Object.entries(prompts)) {
                    if (info.source === 'mcp') {
                        mcpPrompts.push(name);
                    } else if (info.source === 'internal') {
                        internalPrompts.push(name);
                    } else if (info.source === 'starter') {
                        starterPrompts.push(name);
                    } else if (info.source === 'custom') {
                        customPrompts.push(name);
                    }
                }

                if (mcpPrompts.length > 0) {
                    console.log(chalk.cyan('🔗 MCP Prompts:'));
                    mcpPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            // Only show title if it's different from name
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

                if (internalPrompts.length > 0) {
                    console.log(chalk.magenta('📁 Internal Prompts:'));
                    internalPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            // Only show title if it's different from name
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
                            // Only show title if it's different from name
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
                            // Only show title if it's different from name
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
                return true;
            } catch (error) {
                console.error(
                    chalk.red(
                        `Error listing prompts: ${error instanceof Error ? error.message : String(error)}`
                    )
                );
                return false;
            }
        },
    },
    {
        // TODO: (355) USER TO CHECK: Nit: rename to 'use prompt'?
        // https://github.com/truffle-ai/dexto/pull/355#discussion_r2412938399
        name: 'use',
        description: 'Use a specific prompt with optional arguments',
        usage: '/<prompt-name> [args]',
        category: 'Prompt Management',
        handler: async (args: string[], agent: DextoAgent): Promise<boolean> => {
            try {
                if (args.length === 0) {
                    console.log(chalk.red('❌ Please specify a prompt name'));
                    console.log(chalk.dim('Usage: /<prompt-name> [args]'));
                    console.log(
                        chalk.dim(
                            'Example: /code-review language=javascript code="console.log(\'hello\')"'
                        )
                    );
                    return true;
                }

                const promptName = args[0];
                const promptArgs = args.slice(1);

                // Check if prompt exists
                if (!promptName || !(await agent.hasPrompt(promptName))) {
                    console.log(chalk.red(`❌ Prompt '${promptName}' not found`));
                    console.log(chalk.dim('Use /prompts to see available prompts'));
                    return true;
                }

                const { argMap, context } = splitPromptArguments(promptArgs);

                console.log(chalk.cyan(`🤖 Using prompt: ${promptName}`));
                if (Object.keys(argMap).length > 0) {
                    console.log(chalk.dim(`Arguments: ${JSON.stringify(argMap)}`));
                }
                if (context) {
                    console.log(chalk.dim(`Context: ${context}`));
                }

                const result = await agent.getPrompt(promptName!, argMap);

                const flattened = flattenPromptResult(result);
                if (flattened.resourceUris.length > 0) {
                    console.log(
                        chalk.dim(
                            `Resources: ${flattened.resourceUris.map((uri) => `@<${uri}>`).join(', ')}`
                        )
                    );
                }

                const finalText = appendContext(flattened.text, context);

                if (finalText.trim()) {
                    await agent.run(finalText.trim());
                } else {
                    console.log(chalk.yellow(`⚠️  Prompt '${promptName}' returned no content`));
                }

                return true;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to use prompt: ${errorMessage}`);

                if (errorMessage.includes('not found')) {
                    console.log(
                        chalk.red(
                            `❌ Prompt not found. Try running /prompts to see available prompts.`
                        )
                    );
                } else {
                    console.log(chalk.red(`❌ Error: ${errorMessage}`));
                }
                return true;
            }
        },
    },
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
        handler: async (args: string[], agent: DextoAgent): Promise<boolean> => {
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

                const result = await agent.getPrompt(promptInfo.name, argMap);

                const flattened = flattenPromptResult(result);
                if (flattened.resourceUris.length > 0) {
                    console.log(
                        chalk.dim(
                            `Resources: ${flattened.resourceUris.map((uri) => `@<${uri}>`).join(', ')}`
                        )
                    );
                }

                const finalText = appendContext(flattened.text, contextString);

                if (finalText.trim()) {
                    await agent.run(finalText.trim());
                } else {
                    console.log(
                        chalk.yellow(`⚠️  Prompt '${promptInfo.name}' returned no content`)
                    );
                }

                return true;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(
                    `Failed to execute prompt command '${promptInfo.name}': ${errorMessage}`
                );

                console.log(
                    chalk.red(`❌ Error executing prompt '${promptInfo.name}': ${errorMessage}`)
                );
                return true;
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

function appendContext(text: string, context?: string): string {
    if (!context || context.trim().length === 0) {
        return text ?? '';
    }
    if (!text || text.trim().length === 0) {
        return context;
    }
    return `${text.trim()}\n\n${context}`;
}
