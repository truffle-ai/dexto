import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { flattenPromptResult } from '@dexto/core';
import { ToolError } from '@dexto/core';

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

export function createInvokeSkillTool(): Tool {
    return {
        id: 'invoke_skill',
        description: buildToolDescription(),
        inputSchema: InvokeSkillInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { skill, args, taskContext } = input as InvokeSkillInput;

            const promptManager = context.services?.prompts;
            if (!promptManager) {
                throw ToolError.configInvalid(
                    'invoke_skill requires ToolExecutionContext.services.prompts'
                );
            }

            const autoInvocable = await promptManager.listAutoInvocablePrompts();

            let skillKey: string | undefined;
            for (const key of Object.keys(autoInvocable)) {
                const info = autoInvocable[key];
                if (!info) continue;
                if (
                    key === skill ||
                    info.displayName === skill ||
                    info.commandName === skill ||
                    info.name === skill
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

            const promptDef = await promptManager.getPromptDefinition(skillKey);

            const promptResult = await promptManager.getPrompt(skillKey, args);
            const flattened = flattenPromptResult(promptResult);
            const content = flattened.text;

            if (promptDef?.context === 'fork') {
                const taskForker = context.services?.taskForker;
                if (!taskForker) {
                    return {
                        error: `Skill '${skill}' requires fork execution (context: fork), but agent spawning is not available.`,
                        skill: skillKey,
                    };
                }

                const instructions = taskContext
                    ? `## Task Context\n${taskContext}\n\n## Skill Instructions\n${content}`
                    : content;

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
                    autoApprove: true,
                };
                if (promptDef.agent) {
                    forkOptions.agentId = promptDef.agent;
                }
                if (context.toolCallId) {
                    forkOptions.toolCallId = context.toolCallId;
                }
                if (context.sessionId) {
                    forkOptions.sessionId = context.sessionId;
                }

                const result = await taskForker.fork(forkOptions);

                if (result.success) {
                    return result.response ?? 'Task completed successfully.';
                }
                return `Error: ${result.error ?? 'Unknown error during forked execution'}`;
            }

            return {
                skill: skillKey,
                content,
                instructions:
                    'Follow the instructions in the skill content above to complete the task.',
            };
        },
    };
}

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
