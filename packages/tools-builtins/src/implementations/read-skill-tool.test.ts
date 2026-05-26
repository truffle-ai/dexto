import type { ToolExecutionContext } from '@dexto/core/tools';
import { ToolError } from '@dexto/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { createReadSkillTool } from './read-skill-tool.js';

describe('read_skill tool', () => {
    it('returns primary skill instructions when no path is provided', async () => {
        const skills = {
            get: vi.fn().mockResolvedValue({
                id: 'alpha',
                displayName: 'Alpha',
                instructions: 'Use alpha instructions.',
            }),
        };
        const tool = createReadSkillTool();

        const result = await tool.execute({ skill: 'Alpha' }, {
            services: { skills },
        } as unknown as ToolExecutionContext);

        expect(skills.get).toHaveBeenCalledWith('Alpha');
        expect(result).toEqual({
            success: true,
            skill: 'alpha',
            displayName: 'Alpha',
            content: 'Use alpha instructions.',
        });
    });

    it('delegates file reads to SkillManager when path is provided', async () => {
        const skills = {
            get: vi.fn(),
            readFile: vi.fn().mockResolvedValue('# Details\nUse more context.'),
        };
        const tool = createReadSkillTool();

        const result = await tool.execute({ skill: 'Alpha', path: 'docs/details.md' }, {
            services: { skills },
        } as unknown as ToolExecutionContext);

        expect(skills.get).not.toHaveBeenCalled();
        expect(skills.readFile).toHaveBeenCalledWith('Alpha', 'docs/details.md');
        expect(result).toEqual({
            success: true,
            skill: 'Alpha',
            path: 'docs/details.md',
            content: '# Details\nUse more context.',
        });
    });

    it('returns a structured error when the skill is missing', async () => {
        const skills = {
            get: vi.fn().mockResolvedValue(null),
        };
        const tool = createReadSkillTool();

        const result = await tool.execute({ skill: 'Missing' }, {
            services: { skills },
        } as unknown as ToolExecutionContext);

        expect(result).toEqual({
            success: false,
            error: 'Skill not found: Missing',
            _hint: 'Use a skill from the available skills list.',
        });
    });

    it('returns a structured error when a skill file is missing', async () => {
        const skills = {
            readFile: vi.fn().mockRejectedValue(new Error('Skill file not found')),
        };
        const tool = createReadSkillTool();

        const result = await tool.execute({ skill: 'Alpha', path: 'missing.md' }, {
            services: { skills },
        } as unknown as ToolExecutionContext);

        expect(result).toEqual({
            success: false,
            error: 'Skill file not found: Alpha/missing.md',
            _hint: 'Use a valid file path from the skill bundle.',
        });
    });

    it('requires ToolExecutionContext.services.skills', async () => {
        const tool = createReadSkillTool();

        await expect(
            tool.execute({ skill: 'Alpha' }, {} as ToolExecutionContext)
        ).rejects.toMatchObject({
            code: ToolError.configInvalid(
                'read_skill requires ToolExecutionContext.services.skills'
            ).code,
        });
    });
});
