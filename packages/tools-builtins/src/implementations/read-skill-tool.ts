import { z } from 'zod';
import { ToolError, createLocalToolCallHeader, defineTool } from '@dexto/core/tools';
import type { Tool, ToolExecutionContext } from '@dexto/core/tools';

type ReadableSkill = {
    id: string;
    displayName: string;
    instructions: string;
};

type SkillManagerService = {
    get(id: string): Promise<ReadableSkill | null>;
    readFile(skillId: string, path: string): Promise<string>;
};

const ReadSkillInputSchema = z
    .object({
        skill: z.string().min(1, 'Skill name is required'),
        path: z.string().min(1).optional(),
    })
    .strict();

export function createReadSkillTool(): Tool<typeof ReadSkillInputSchema> {
    return defineTool({
        id: 'read_skill',
        description:
            'Read skill instructions or a file from a skill bundle. This is read-only and does not invoke the skill.',
        inputSchema: ReadSkillInputSchema,
        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Read Skill',
                    argsText: input.path ? `${input.skill}/${input.path}` : input.skill,
                }),
        },
        async execute(input, context: ToolExecutionContext) {
            const skillManager = getSkillManager(context);
            if (!skillManager) {
                throw ToolError.configInvalid(
                    'read_skill requires ToolExecutionContext.services.skills'
                );
            }

            if (input.path) {
                try {
                    const content = await skillManager.readFile(input.skill, input.path);
                    return {
                        success: true,
                        skill: input.skill,
                        path: input.path,
                        content,
                    };
                } catch {
                    return {
                        success: false,
                        error: `Skill file not found: ${input.skill}/${input.path}`,
                        _hint: 'Use a valid file path from the skill bundle.',
                    };
                }
            }

            const skill = await skillManager.get(input.skill);
            if (!skill) {
                return {
                    success: false,
                    error: `Skill not found: ${input.skill}`,
                    _hint: 'Use a skill from the available skills list.',
                };
            }

            return {
                success: true,
                skill: skill.id,
                displayName: skill.displayName,
                content: skill.instructions,
            };
        },
    });
}

function getSkillManager(context: ToolExecutionContext): SkillManagerService | undefined {
    const services = context.services as
        | (ToolExecutionContext['services'] & { skills?: SkillManagerService })
        | undefined;
    return services?.skills;
}
