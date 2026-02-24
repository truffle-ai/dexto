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

                return formatForInkCli(output);
            } catch (error) {
                const errorMsg = `Error listing prompts: ${error instanceof Error ? error.message : String(error)}`;
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
    // Note: /use command removed - use /<prompt-name> directly instead
    // Prompts are automatically registered as slash commands (see getDynamicPromptCommands)
];

/**
 * Create a dynamic command definition from a prompt
 * @param promptInfo The prompt metadata with pre-computed commandName
 */
function createPromptCommand(promptInfo: PromptInfo): CommandDefinition {
    // Use pre-computed commandName (collision-resolved by PromptManager)
    // Fall back to displayName or name for backwards compatibility
    const commandName = promptInfo.commandName || promptInfo.displayName || promptInfo.name;
    // Keep internal name for prompt resolution (e.g., "config:review" or "mcp:server1:review")
    const internalName = promptInfo.name;
    // Base name for display purposes (without source prefix)
    const baseName = promptInfo.displayName || promptInfo.name;

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
                        try {
                            await agent.switchLLM({ model: result.model }, ctx.sessionId);
                        } catch (modelError) {
                            agent.logger.warn('Failed to switch model for prompt override', {
                                model: result.model,
                                error:
                                    modelError instanceof Error
                                        ? modelError.message
                                        : String(modelError),
                            });
                        }
                    }

                    // Apply auto-approve tools if specified
                    // These tools will skip confirmation prompts during skill execution
                    if (result.allowedTools && result.allowedTools.length > 0) {
                        try {
                            agent.toolManager.addSessionAutoApproveTools(
                                ctx.sessionId,
                                result.allowedTools
                            );
                        } catch (toolError) {
                            agent.logger.warn('Failed to set auto-approve tools for prompt', {
                                tools: result.allowedTools,
                                error:
                                    toolError instanceof Error
                                        ? toolError.message
                                        : String(toolError),
                            });
                        }
                    }
                }

                if (result.context !== 'fork' && result.toolkits && result.toolkits.length > 0) {
                    if (!agent.loadToolkits) {
                        return formatForInkCli(
                            `❌ Skill '${commandName}' requires toolkits (${result.toolkits.join(', ')}), but this agent does not support dynamic tool loading.`
                        );
                    }

                    try {
                        await agent.loadToolkits(result.toolkits);
                    } catch (error) {
                        return formatForInkCli(
                            `❌ Failed to load toolkits for skill '${commandName}': ${
                                error instanceof Error ? error.message : String(error)
                            }`
                        );
                    }
                }

                // Fork skills: route through LLM to call invoke_skill
                // This ensures approval flow and context management work naturally through
                // processStream, rather than bypassing it with direct tool execution.
                if (result.context === 'fork') {
                    const skillName = internalName;
                    const taskContext = contextString || '';

                    // Build instruction message for the LLM
                    // The <skill-invocation> tags help the LLM recognize this is a structured request
                    const instructionText = `<skill-invocation>
Execute the fork skill: ${commandName}
${taskContext ? `Task context: ${taskContext}` : ''}

Call the invoke_skill tool immediately with:
- skill: "${skillName}"
${taskContext ? `- taskContext: "${taskContext}"` : ''}
</skill-invocation>`;

                    return createSendMessageMarker(instructionText);
                }

                // Inline skills: wrap content in <skill-invocation> for clean history display
                // Convert resource URIs to @resource mentions so agent.run() can expand them
                let finalText = result.text;
                if (result.resources.length > 0) {
                    // Append resource references as @<uri> format
                    const resourceRefs = result.resources.map((uri) => `@<${uri}>`).join(' ');
                    finalText = finalText ? `${finalText}\n\n${resourceRefs}` : resourceRefs;
                }

                if (finalText.trim()) {
                    // Wrap in <skill-invocation> tags for clean display in history
                    // The tags help formatSkillInvocationMessage() detect and format these
                    const taskContext = contextString || '';
                    const wrappedText = `<skill-invocation>
Execute the inline skill: ${commandName}
${taskContext ? `Task context: ${taskContext}` : ''}

skill: "${internalName}"
</skill-invocation>

${finalText.trim()}`;

                    return createSendMessageMarker(wrappedText);
                } else {
                    const warningMsg = `⚠️  Prompt '${commandName}' returned no content`;
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
 * Uses pre-computed commandName from PromptManager for collision handling.
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

        // Create commands using pre-computed commandName (collision-resolved by PromptManager)
        return promptEntries.map(([, info]) => createPromptCommand(info));
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
