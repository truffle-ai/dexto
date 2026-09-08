import { describe, expect, it } from 'vitest';
import { SkillLoadInputSchema } from './contracts.js';

describe('skill_load contract', () => {
    it('accepts an exact skill name with an optional supporting-file path', () => {
        expect(SkillLoadInputSchema.parse({ name: 'review' })).toEqual({
            name: 'review',
        });
        expect(
            SkillLoadInputSchema.parse({ name: 'review', path: 'references/checklist.md' })
        ).toEqual({
            name: 'review',
            path: 'references/checklist.md',
        });
    });

    it('rejects legacy invocation fields and empty names', () => {
        expect(() =>
            SkillLoadInputSchema.parse({
                skill: 'review',
                args: {},
                taskContext: {},
            })
        ).toThrow();
        expect(() => SkillLoadInputSchema.parse({ name: '' })).toThrow();
    });

    it('rejects absolute and traversal paths', () => {
        expect(() =>
            SkillLoadInputSchema.parse({ name: 'review', path: '/tmp/file.md' })
        ).toThrow();
        expect(() =>
            SkillLoadInputSchema.parse({ name: 'review', path: 'references/../secret.md' })
        ).toThrow();
        expect(() =>
            SkillLoadInputSchema.parse({ name: 'review', path: String.raw`C:\tmp\file.md` })
        ).toThrow();
        expect(() =>
            SkillLoadInputSchema.parse({ name: 'review', path: 'C:tmp/file.md' })
        ).toThrow();
    });
});
