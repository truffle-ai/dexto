/**
 * Prompt Commands Module
 *
 * This module defines prompt management slash commands for the Dexto CLI interface.
 * These commands provide functionality for viewing and managing system prompts.
 *
 * Available Prompt Commands:
 * - /prompt - Display the current system prompt
 * - /prompts - List all available prompts (MCP + internal)
 * - /<prompt-name> [args] - Direct prompt execution (auto-generated for each prompt)
 */

import chalk from 'chalk';
import { logger, type DextoAgent } from '@dexto/core';
import type { PromptInfo } from '@dexto/core';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { CommandDefinition } from './command-parser.js';
// Avoid depending on core types to keep CLI typecheck independent of build

/**
 * Prompt management commands
 */
export const promptCommands: CommandDefinition[] = [
    {
        name: 'prompt',
        description: 'Display the current system prompt',
        usage: '/prompt',
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
                const prompts = (await agent.promptsManager.list()) as Record<string, PromptInfo>;
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

                for (const [name, info] of Object.entries(prompts)) {
                    if (info.source === 'mcp') {
                        mcpPrompts.push(name);
                    } else if (info.source === 'internal') {
                        internalPrompts.push(name);
                    } else if (info.source === 'starter') {
                        starterPrompts.push(name);
                    }
                }

                if (mcpPrompts.length > 0) {
                    console.log(chalk.cyan('🔗 MCP Prompts:'));
                    mcpPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const title = info.title ? ` (${info.title})` : '';
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
                            const title = info.title ? ` (${info.title})` : '';
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
                            const title = info.title ? ` (${info.title})` : '';
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
                if (!promptName || !(await agent.promptsManager.has(promptName))) {
                    console.log(chalk.red(`❌ Prompt '${promptName}' not found`));
                    console.log(chalk.dim('Use /prompts to see available prompts'));
                    return true;
                }

                // Parse arguments into key-value pairs
                const parsedArgs: Record<string, string> = {};
                for (const arg of promptArgs) {
                    const [key, ...valueParts] = arg.split('=');
                    if (key && valueParts.length > 0) {
                        parsedArgs[key] = valueParts.join('=');
                    }
                }

                console.log(chalk.cyan(`🤖 Using prompt: ${promptName}`));
                if (Object.keys(parsedArgs).length > 0) {
                    console.log(chalk.dim(`Arguments: ${JSON.stringify(parsedArgs)}`));
                }

                // Get the prompt
                const result: GetPromptResult = await agent.promptsManager.getPrompt(
                    promptName!,
                    parsedArgs
                );

                // Extract the prompt text and send it to the agent
                let promptText = '';
                if (result.messages && result.messages.length > 0) {
                    for (const message of result.messages) {
                        const content = (message as { content?: unknown }).content;
                        if (typeof content === 'string') {
                            promptText += content + '\n';
                        } else if (Array.isArray(content)) {
                            for (const part of content) {
                                if (
                                    part &&
                                    typeof part === 'object' &&
                                    'type' in part &&
                                    (part as { type: string }).type === 'text' &&
                                    'text' in part
                                ) {
                                    const t = (part as { text?: unknown }).text;
                                    if (typeof t === 'string') promptText += t + '\n';
                                }
                            }
                        } else if (
                            content &&
                            typeof content === 'object' &&
                            'type' in content &&
                            (content as { type: string }).type === 'text' &&
                            'text' in content
                        ) {
                            const t = (content as { text?: unknown }).text;
                            if (typeof t === 'string') promptText += t + '\n';
                        }
                    }
                }

                if (promptText.trim()) {
                    // Send the populated prompt text to the AI agent for processing
                    await agent.run(promptText.trim());
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
                // Parse arguments intelligently
                const parsedArgs: Record<string, string> = {};

                // First, try to parse key=value format
                for (const arg of args) {
                    const [key, ...valueParts] = arg.split('=');
                    if (key && valueParts.length > 0) {
                        parsedArgs[key] = valueParts.join('=');
                    }
                }

                // If no key=value args, treat all args as context for the LLM to extrapolate
                if (Object.keys(parsedArgs).length === 0 && args.length > 0) {
                    // For prompts like "explain", "code-review", etc., treat args as natural language context
                    const contextString = args.join(' ');
                    parsedArgs['_context'] = contextString;
                    console.log(chalk.cyan(`🤖 Executing prompt: ${promptInfo.name}`));
                    console.log(
                        chalk.dim(
                            `Context: ${contextString} (LLM will extrapolate template variables)`
                        )
                    );
                } else if (Object.keys(parsedArgs).length > 0) {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${promptInfo.name}`));
                    console.log(chalk.dim(`Explicit arguments: ${JSON.stringify(parsedArgs)}`));
                } else {
                    console.log(chalk.cyan(`🤖 Executing prompt: ${promptInfo.name}`));
                    console.log(
                        chalk.dim('No arguments provided - LLM will extrapolate from context')
                    );
                }

                // Get the prompt
                const result: GetPromptResult = await agent.promptsManager.getPrompt(
                    promptInfo.name,
                    parsedArgs
                );

                // Extract the prompt text and send it to the agent
                let promptText = '';
                if (result.messages && result.messages.length > 0) {
                    for (const message of result.messages) {
                        const content = (message as { content?: unknown }).content;
                        if (typeof content === 'string') {
                            promptText += content + '\n';
                        } else if (Array.isArray(content)) {
                            for (const part of content) {
                                if (
                                    part &&
                                    typeof part === 'object' &&
                                    'type' in part &&
                                    (part as { type: string }).type === 'text' &&
                                    'text' in part
                                ) {
                                    const t = (part as { text?: unknown }).text;
                                    if (typeof t === 'string') promptText += t + '\n';
                                }
                            }
                        } else if (
                            content &&
                            typeof content === 'object' &&
                            'type' in content &&
                            (content as { type: string }).type === 'text' &&
                            'text' in content
                        ) {
                            const t = (content as { text?: unknown }).text;
                            if (typeof t === 'string') promptText += t + '\n';
                        }
                    }
                }

                if (promptText.trim()) {
                    // Send the populated prompt text to the AI agent for processing
                    await agent.run(promptText.trim());
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
        const prompts = (await agent.promptsManager.list()) as Record<string, PromptInfo>;
        return Object.values(prompts).map(createPromptCommand);
    } catch (error) {
        logger.error(
            `Failed to get dynamic prompt commands: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}
