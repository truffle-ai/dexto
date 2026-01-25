import { z } from 'zod';
import type { InternalTool, ToolExecutionContext } from '../../types.js';
import type { InternalToolsServices } from '../registry.js';
import { flattenPromptResult } from '../../../prompts/utils.js';

const InvokeSkillInputSchema = z
    .object({
        skill: z
            .string()
            .min(1, 'Skill name is required')
            .describe(
                'The name of the skill to invoke (e.g., "plugin-name:skill-name" or "skill-name")'
            ),
        args: z.record(z.string()).optional().describe('Optional arguments to pass to the skill'),
        taskContext: z
            .string()
            .optional()
            .describe(
                'Context about what task this skill should accomplish. Recommended for forked skills to provide context since they run in isolation without conversation history.'
            ),
    })
    .strict();

type InvokeSkillInput = z.input<typeof InvokeSkillInputSchema>;

/**
 * Internal tool for invoking skills/prompts during agent execution.
 *
 * This tool allows the LLM to load and execute skills that are registered
 * with the PromptManager. Skills are prompts that can be auto-invoked by
 * the model (not disabled via `disableModelInvocation`).
 *
 * Execution modes:
 * - **inline** (default): Skill content is returned for the LLM to follow in the current session
 * - **fork**: Skill is executed in an isolated subagent with no conversation history access
 *
 * Usage:
 * - The LLM sees available skills in its system prompt
 * - When a skill is relevant, the LLM calls this tool with the skill name
 * - For inline skills: content is returned for the LLM to follow
 * - For forked skills: execution happens in isolation and result is returned
 *
 * Note: Takes services object (not individual deps) to support late-binding of taskForker.
 * The taskForker may be set after tool creation when agent-spawner custom tool is registered.
 */
export function createInvokeSkillTool(services: InternalToolsServices): InternalTool {
    return {
        id: 'invoke_skill',
        description: buildToolDescription(),
        inputSchema: InvokeSkillInputSchema,
        execute: async (input: unknown, context?: ToolExecutionContext) => {
            const { skill, args, taskContext } = input as InvokeSkillInput;

            // Get promptManager from services (set via setPromptManager before initialize)
            const promptManager = services.promptManager;
            if (!promptManager) {
                return {
                    error: 'PromptManager not available. This is a configuration error.',
                };
            }

            // Check if the prompt exists and is auto-invocable
            const autoInvocable = await promptManager.listAutoInvocablePrompts();

            // Find the skill by checking various name formats
            let skillKey: string | undefined;
            for (const key of Object.keys(autoInvocable)) {
                const info = autoInvocable[key];
                if (!info) continue;
                // Match by full key, displayName, commandName, or name
                if (
                    key === skill ||
                    info.displayName === skill ||
                    info.commandName === skill ||
                    info.name === skill ||
                    info.name === `config:${skill}`
                ) {
                    skillKey = key;
                    break;
                }
            }

            if (!skillKey) {
                return {
                    error: `Skill '${skill}' not found or not available for model invocation. Use a skill from the available list.`,
                    availableSkills: Object.keys(autoInvocable),
                };
            }

            // Get the prompt definition to check execution context
            const promptDef = await promptManager.getPromptDefinition(skillKey);

            // Get the prompt content with arguments applied
            const promptResult = await promptManager.getPrompt(skillKey, args);
            const flattened = flattenPromptResult(promptResult);
            const content = flattened.text;

            // Check if this skill should be forked (executed in isolated subagent)
            if (promptDef?.context === 'fork') {
                // Fork execution - run in isolated subagent via taskForker
                // taskForker is looked up lazily to support late-binding (set after tool creation)
                const taskForker = services.taskForker;
                if (!taskForker) {
                    return {
                        error: `Skill '${skill}' requires fork execution (context: fork), but agent spawning is not available. Configure agent-spawner custom tool to enable forked skills.`,
                        skill: skillKey,
                    };
                }

                // Build instructions for the forked agent
                let instructions: string;
                if (taskContext) {
                    instructions = `## Task Context\n${taskContext}\n\n## Skill Instructions\n${content}`;
                } else {
                    instructions = content;
                }

                // Execute in isolated context via taskForker
                const forkOptions: {
                    task: string;
                    instructions: string;
                    agentId?: string;
                    autoApprove?: boolean;
                    toolCallId?: string;
                    sessionId?: string;
                } = {
                    task: `Skill: ${skill}`,
                    instructions,
                    // Fork skills auto-approve by default since they run in isolation
                    autoApprove: true,
                };
                // Pass agent from skill definition if specified
                if (promptDef.agent) {
                    forkOptions.agentId = promptDef.agent;
                }
                if (context?.toolCallId) {
                    forkOptions.toolCallId = context.toolCallId;
                }
                if (context?.sessionId) {
                    forkOptions.sessionId = context.sessionId;
                }

                const result = await taskForker.fork(forkOptions);

                if (result.success) {
                    // Return just the result text - no JSON wrapping
                    // This gives cleaner display in CLI and WebUI
                    return result.response ?? 'Task completed successfully.';
                } else {
                    // For errors, return a simple error message
                    return `Error: ${result.error ?? 'Unknown error during forked execution'}`;
                }
            }

            // Inline execution (default) - return content for LLM to follow
            return {
                skill: skillKey,
                content,
                instructions:
                    'Follow the instructions in the skill content above to complete the task.',
            };
        },
    };
}

/**
 * Builds the tool description.
 */
function buildToolDescription(): string {
    return `Invoke a skill to load and execute specialized instructions for a task. Skills are predefined prompts that guide how to handle specific scenarios.

When to use:
- When you recognize a task that matches an available skill
- When you need specialized guidance for a complex operation
- When the user references a skill by name

Parameters:
- skill: The name of the skill to invoke
- args: Optional arguments to pass to the skill (e.g., for $ARGUMENTS substitution)
- taskContext: Context about what you're trying to accomplish (important for forked skills that run in isolation)

Execution modes:
- **Inline skills**: Return instructions for you to follow in the current conversation
- **Fork skills**: Automatically execute in an isolated subagent and return the result (no additional tool calls needed)

Fork skills run in complete isolation without access to conversation history. They're useful for tasks that should run independently.

Available skills are listed in your system prompt. Use the skill name exactly as shown.`;
}
