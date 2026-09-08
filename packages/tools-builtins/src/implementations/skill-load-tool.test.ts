import type { ToolExecutionContext } from '@dexto/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { createSkillLoadTool } from './skill-load-tool.js';

describe('skill_load tool', () => {
    it('loads one exact skill without listing the skill catalog', async () => {
        const skills = {
            list: vi.fn(),
            load: vi.fn().mockResolvedValue({
                name: 'alpha',
                instructions: 'Use alpha instructions.',
                supportingFiles: [],
                filesLocation: 'hosted',
                baseDirectory: null,
            }),
            readFile: vi.fn(),
        };
        const tool = createSkillLoadTool();

        const result = await tool.execute({ name: 'alpha' }, {
            services: { skills },
        } as unknown as ToolExecutionContext);

        expect(skills.load).toHaveBeenCalledWith('alpha');
        expect(skills.list).not.toHaveBeenCalled();
        expect(result).toEqual({
            name: 'alpha',
            instructions: 'Use alpha instructions.',
            supportingFiles: [],
            filesLocation: 'hosted',
            baseDirectory: null,
        });
    });

    it('returns a structured unavailable result when loading fails', async () => {
        const skills = {
            list: vi.fn().mockResolvedValue([
                { name: 'alpha', description: 'Alpha instructions' },
                { name: 'beta', description: 'Beta instructions' },
            ]),
            load: vi.fn().mockRejectedValue(new Error('release unavailable')),
            readFile: vi.fn(),
        };

        const result = await createSkillLoadTool().execute({ name: 'missing' }, {
            services: { skills },
        } as unknown as ToolExecutionContext);

        expect(result).toEqual({
            error: 'Skill unavailable: missing',
            availableSkills: ['alpha', 'beta'],
            _hint: 'Use the exact name from the available Skills list.',
        });
    });

    it('reads a supporting file and isolates file failures', async () => {
        const skills = {
            list: vi.fn().mockResolvedValue([{ name: 'alpha', description: 'Alpha instructions' }]),
            load: vi.fn(),
            readFile: vi
                .fn()
                .mockResolvedValueOnce('Checklist')
                .mockRejectedValueOnce(new Error('artifact unavailable')),
        };
        const tool = createSkillLoadTool();
        const context = { services: { skills } } as unknown as ToolExecutionContext;

        await expect(
            tool.execute({ name: 'alpha', path: 'references/checklist.md' }, context)
        ).resolves.toEqual({
            name: 'alpha',
            path: 'references/checklist.md',
            content: 'Checklist',
        });

        await expect(
            tool.execute({ name: 'alpha', path: 'references/missing.md' }, context)
        ).resolves.toEqual({
            error: 'Skill file unavailable: alpha/references/missing.md',
            availableSkills: ['alpha'],
            _hint: 'Use a valid relative file path from the selected Skill.',
        });
        expect(skills.load).not.toHaveBeenCalled();
    });
});
