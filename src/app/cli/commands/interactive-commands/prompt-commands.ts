/**
 * Prompt Commands Module
 *
 * This module defines prompt management slash commands for the Dexto CLI interface.
 * These commands provide functionality for viewing and managing system prompts.
 *
 * Available Prompt Commands:
 * - /prompt - Display the current system prompt
 * - /prompts - List all available prompts (MCP + internal)
 * - /use <prompt-name> [args] - Use a specific prompt with optional arguments
 * - /<prompt-name> [args] - Direct prompt execution (auto-generated for each prompt)
 */

import chalk from 'chalk';
import { logger } from '@core/index.js';
import type { DextoAgent } from '@core/index.js';
import type { CommandDefinition } from './command-parser.js';
import type { PromptInfo } from '@core/prompts/types.js';

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
        handler: async (args: string[], agent: DextoAgent): Promise<boolean> => {
            try {
                const prompts = await agent.promptsManager.list();
                const promptNames = Object.keys(prompts);

                if (promptNames.length === 0) {
                    console.log(chalk.yellow('\n⚠️  No prompts available'));
                    return true;
                }

                console.log(chalk.bold.green('\n📝 Available Prompts:\n'));

                // Group by source
                const mcpPrompts: string[] = [];
                const internalPrompts: string[] = [];

                for (const [name, info] of Object.entries(prompts)) {
                    if (info.source === 'mcp') {
                        mcpPrompts.push(name);
                    } else if (info.source === 'internal') {
                        internalPrompts.push(name);
                    }
                }

                if (mcpPrompts.length > 0) {
                    console.log(chalk.cyan('🔗 MCP Prompts:'));
                    mcpPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const desc = info.description ? ` - ${info.description}` : '';
                            console.log(`  ${chalk.blue(name)}${chalk.dim(desc)}`);
                        }
                    });
                    console.log();
                }

                if (internalPrompts.length > 0) {
                    console.log(chalk.cyan('📁 Internal Prompts:'));
                    internalPrompts.forEach((name) => {
                        const info = prompts[name];
                        if (info) {
                            const desc = info.description ? ` - ${info.description}` : '';
                            console.log(`  ${chalk.blue(name)}${chalk.dim(desc)}`);
                        }
                    });
                    console.log();
                }

                console.log(chalk.dim(`Total: ${promptNames.length} prompts`));
                console.log(
                    chalk.dim(
                        'Use /<prompt-name> <context> to execute with natural language context'
                    )
                );
                console.log(
                    chalk.dim(
                        'Examples: /explain quantum mechanics, /code-review my function, /debug this error'
                    )
                );
                console.log(
                    chalk.dim(
                        'The LLM will intelligently understand your request and execute the prompt'
                    )
                );
            } catch (error) {
                logger.error(
                    `Failed to list prompts: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            return true;
        },
    },
    {
        name: 'use',
        description: 'Use a specific prompt with optional arguments',
        usage: '/use <prompt-name> [args]',
        category: 'Prompt Management',
        handler: async (args: string[], agent: DextoAgent): Promise<boolean> => {
            try {
                if (args.length === 0) {
                    console.log(chalk.red('❌ Please specify a prompt name'));
                    console.log(chalk.dim('Usage: /use <prompt-name> [args]'));
                    console.log(
                        chalk.dim(
                            'Example: /use code-review language=javascript code="console.log(\'hello\')"'
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
                const result = await agent.promptsManager.getPrompt(promptName!, parsedArgs);

                // Extract the prompt text and send it to the agent
                let promptText = '';
                if (result.messages && result.messages.length > 0) {
                    for (const message of result.messages) {
                        if (typeof message.content === 'string') {
                            promptText += message.content + '\n';
                        } else if (
                            message.content &&
                            typeof message.content === 'object' &&
                            'text' in message.content
                        ) {
                            promptText += message.content.text + '\n';
                        } else if (Array.isArray(message.content)) {
                            for (const content of message.content) {
                                if (content.type === 'text') {
                                    promptText += content.text + '\n';
                                }
                            }
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
                const result = await agent.promptsManager.getPrompt(promptInfo.name, parsedArgs);

                // Extract the prompt text and send it to the agent
                let promptText = '';
                if (result.messages && result.messages.length > 0) {
                    for (const message of result.messages) {
                        if (typeof message.content === 'string') {
                            promptText += message.content + '\n';
                        } else if (
                            message.content &&
                            typeof message.content === 'object' &&
                            'text' in message.content
                        ) {
                            promptText += message.content.text + '\n';
                        } else if (Array.isArray(message.content)) {
                            for (const content of message.content) {
                                if (content.type === 'text') {
                                    promptText += content.text + '\n';
                                }
                            }
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
        const prompts = await agent.promptsManager.list();
        return Object.values(prompts).map(createPromptCommand);
    } catch (error) {
        logger.error(
            `Failed to get dynamic prompt commands: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}
