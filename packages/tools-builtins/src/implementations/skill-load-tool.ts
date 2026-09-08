import { SkillLoadInputSchema } from '@dexto/core';
import { TOOL_ACTIVITY, ToolError, createLocalToolCallHeader, defineTool } from '@dexto/core/tools';
import type { Tool, ToolExecutionContext } from '@dexto/core/tools';
import type { Skills } from '@dexto/core';

async function unavailableSkillResult(
    skills: Skills,
    error: string,
    hint: string
): Promise<Record<string, unknown>> {
    let availableSkills: string[] | undefined;
    try {
        availableSkills = (await skills.list()).map((skill) => skill.name);
    } catch {
        // A catalog failure should not hide the more specific load failure.
    }

    return {
        error,
        ...(availableSkills === undefined ? {} : { availableSkills }),
        _hint: hint,
    };
}

export function createSkillLoadTool(): Tool<typeof SkillLoadInputSchema> {
    return defineTool({
        id: 'skill_load',
        description: `Load one exact Skill by name.

Without a path, this returns the Skill instructions and the location of its supporting files. With
a path, it reads one supporting text file relative to that Skill. Use the exact name from the
available Skills list; names are not aliases.`,
        inputSchema: SkillLoadInputSchema,
        presentation: {
            activity: TOOL_ACTIVITY.useSkill,
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Load Skill',
                    argsText: input.path ? `${input.name}/${input.path}` : input.name,
                }),
        },
        async execute(input, context: ToolExecutionContext) {
            const skills = context.services?.skills;
            if (!skills) {
                throw ToolError.configInvalid(
                    'skill_load requires ToolExecutionContext.services.skills'
                );
            }

            if (input.path) {
                try {
                    const content = await skills.readFile(input.name, input.path);
                    return {
                        name: input.name,
                        path: input.path,
                        content,
                    };
                } catch {
                    return unavailableSkillResult(
                        skills,
                        `Skill file unavailable: ${input.name}/${input.path}`,
                        'Use a valid relative file path from the selected Skill.'
                    );
                }
            }

            try {
                const loaded = await skills.load(input.name);
                if (loaded) {
                    return loaded;
                }
            } catch {
                return unavailableSkillResult(
                    skills,
                    `Skill unavailable: ${input.name}`,
                    'Use the exact name from the available Skills list.'
                );
            }

            return unavailableSkillResult(
                skills,
                `Skill unavailable: ${input.name}`,
                'Use the exact name from the available Skills list.'
            );
        },
    });
}
