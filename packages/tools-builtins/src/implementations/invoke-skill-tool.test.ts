import type { ToolExecutionContext } from '@dexto/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { createInvokeSkillTool } from './invoke-skill-tool.js';

describe('invoke_skill tool', () => {
    it('invokes skills through SkillManager', async () => {
        const skillManager = {
            list: vi
                .fn()
                .mockResolvedValue([
                    { id: 'alpha', displayName: 'Alpha', description: 'Use alpha' },
                ]),
            invoke: vi.fn().mockResolvedValue({
                id: 'alpha',
                displayName: 'Alpha',
                instructions: 'Use alpha instructions.',
            }),
        };

        const tool = createInvokeSkillTool();
        const result = await tool.execute(
            {
                skill: 'Alpha',
                args: { mode: 'fast' },
            },
            {
                logger: {
                    warn: vi.fn(),
                },
                services: {
                    skills: skillManager,
                },
            } as unknown as ToolExecutionContext
        );

        expect(skillManager.invoke).toHaveBeenCalledWith('Alpha', { mode: 'fast' });
        expect(result).toEqual({
            skill: 'alpha',
            content: 'Use alpha instructions.',
            instructions:
                'Follow the instructions in the skill content above to complete the task.',
        });
    });

    it('adds task context to returned skill instructions', async () => {
        const skillManager = {
            list: vi.fn(),
            invoke: vi.fn().mockResolvedValue({
                id: 'alpha',
                displayName: 'Alpha',
                instructions: 'Use alpha instructions.',
            }),
        };

        const tool = createInvokeSkillTool();
        const result = await tool.execute(
            {
                skill: 'Alpha',
                taskContext: 'Refactor the storage layer.',
            },
            {
                logger: {
                    warn: vi.fn(),
                },
                services: {
                    skills: skillManager,
                },
            } as unknown as ToolExecutionContext
        );

        expect(result).toMatchObject({
            content:
                '## Task Context\nRefactor the storage layer.\n\n## Skill Instructions\nUse alpha instructions.',
        });
    });

    it('returns available skills when the requested skill is missing', async () => {
        const skillManager = {
            list: vi.fn().mockResolvedValue([
                { id: 'alpha', displayName: 'Alpha' },
                { id: 'beta', displayName: 'Beta' },
            ]),
            invoke: vi.fn().mockResolvedValue(null),
        };

        const tool = createInvokeSkillTool();
        const result = await tool.execute({ skill: 'missing' }, {
            logger: {
                warn: vi.fn(),
            },
            services: {
                skills: skillManager,
            },
        } as unknown as ToolExecutionContext);

        expect(result).toEqual({
            error: "Skill 'missing' not found or not available for model invocation. Use a skill from the available list.",
            availableSkills: ['Alpha', 'Beta'],
        });
    });

    it('requires ToolExecutionContext.services.skills', async () => {
        const tool = createInvokeSkillTool();

        await expect(
            tool.execute({ skill: 'alpha' }, {
                logger: {
                    warn: vi.fn(),
                },
            } as unknown as ToolExecutionContext)
        ).rejects.toThrow('invoke_skill requires ToolExecutionContext.services.skills');
    });
});
