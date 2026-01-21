import { z } from 'zod';
import type { InternalTool } from '../../types.js';
import type { PromptManager } from '../../../prompts/prompt-manager.js';
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
 * When invoked, the skill's content is returned and should be used to
 * guide the agent's next actions.
 *
 * Usage:
 * - The LLM sees available skills in its system prompt
 * - When a skill is relevant, the LLM calls this tool with the skill name
 * - The tool returns the skill's content for the LLM to follow
 */
export function createInvokeSkillTool(promptManager: PromptManager): InternalTool {
    return {
        id: 'invoke_skill',
        description: buildToolDescription(promptManager),
        inputSchema: InvokeSkillInputSchema,
        execute: async (input: unknown) => {
            const { skill, args } = input as InvokeSkillInput;

            // Check if the prompt exists and is auto-invocable
            const autoInvocable = await promptManager.listAutoInvocablePrompts();

            // Find the skill by checking various name formats
            let skillKey: string | undefined;
            for (const key of Object.keys(autoInvocable)) {
                const info = autoInvocable[key];
                if (!info) continue;
                // Match by full key, displayName, or name
                if (
                    key === skill ||
                    info.displayName === skill ||
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

            // Get the prompt content
            const promptResult = await promptManager.getPrompt(skillKey, args);

            // Flatten the prompt result to get the text content
            const content = flattenPromptResult(promptResult);

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
 * Builds the tool description with the list of available skills.
 * This is called at registration time, so skills list may update.
 */
function buildToolDescription(promptManager: PromptManager): string {
    // Note: Description is static at registration time.
    // For dynamic skill listing, the system prompt should include available skills.
    return `Invoke a skill to load specialized instructions for a task. Skills are predefined prompts that guide how to handle specific scenarios.

When to use:
- When you recognize a task that matches an available skill
- When you need specialized guidance for a complex operation
- When the user references a skill by name

The skill's content will be returned with instructions to follow.

Available skills are listed in your system prompt. Use the skill name exactly as shown.`;
}
