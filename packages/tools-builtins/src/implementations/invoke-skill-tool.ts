import { z } from 'zod';
import { ToolError, createLocalToolCallHeader, defineTool } from '@dexto/core/tools';
import type { Tool, ToolExecutionContext } from '@dexto/core/tools';

type InvokableSkill = {
    id: string;
    displayName: string;
    instructions: string;
};

type SkillManagerService = {
    list(): Promise<Array<{ displayName: string }>>;
    invoke(id: string, args?: Record<string, string>): Promise<InvokableSkill | null>;
};

const InvokeSkillInputSchema = z
    .object({
        skill: z
            .string()
            .min(1, 'Skill name is required')
            .describe(
                'The name of the skill to invoke (e.g., "plugin-name:skill-name" or "skill-name")'
            ),
        args: z
            .record(z.string(), z.string())
            .optional()
            .describe('Optional arguments to pass to the skill'),
        taskContext: z
            .string()
            .optional()
            .describe('Context about what task this skill should accomplish'),
    })
    .strict();

export function createInvokeSkillTool(): Tool<typeof InvokeSkillInputSchema> {
    return defineTool({
        id: 'invoke_skill',
        description: buildToolDescription(),
        inputSchema: InvokeSkillInputSchema,
        presentation: {
            describeHeader: (input) => {
                const colonIndex = input.skill.indexOf(':');
                const displaySkillName =
                    colonIndex >= 0 ? input.skill.slice(colonIndex + 1) : input.skill;

                return createLocalToolCallHeader({
                    title: 'Skill',
                    argsText: `/${displaySkillName}`,
                });
            },
        },
        async execute(input, context: ToolExecutionContext) {
            const skillManager = context.services?.skills;
            if (!skillManager) {
                throw ToolError.configInvalid(
                    'invoke_skill requires ToolExecutionContext.services.skills'
                );
            }

            const invoked = await skillManager.invoke(input.skill, input.args);
            if (!invoked) {
                const availableSkills = (await skillManager.list()).map(
                    (availableSkill) => availableSkill.displayName
                );
                return {
                    error: `Skill '${input.skill}' not found or not available for model invocation. Use a skill from the available list.`,
                    availableSkills,
                };
            }

            const content = input.taskContext
                ? `## Task Context\n${input.taskContext}\n\n## Skill Instructions\n${invoked.instructions}`
                : invoked.instructions;

            return {
                skill: invoked.id,
                content,
                instructions:
                    'Follow the instructions in the skill content above to complete the task.',
            };
        },
    });
}

function buildToolDescription(): string {
    return `Invoke a skill to load specialized instructions for a task.

When to use:
- When you recognize a task that matches an available skill
- When you need specialized guidance for a complex operation
- When the user references a skill by name

Available skills are listed in your system prompt. Use the skill name exactly as shown.`;
}
