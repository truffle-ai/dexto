import { describe, expect, it, vi } from 'vitest';
import { chooseSkillClash } from './skill-clash.js';

describe('personal skill clash handling', () => {
    it('requires a choice for ask in JSON even if a prompt exists', async () => {
        const prompt = vi.fn(async () => 'rename');
        await expect(chooseSkillClash({ policy: 'ask', json: true, prompt })).rejects.toMatchObject(
            { kind: 'needs_confirmation' }
        );
        expect(prompt).not.toHaveBeenCalled();
    });
    it('requires a choice for ask without a terminal', async () => {
        await expect(
            chooseSkillClash({ policy: 'ask', json: false, prompt: null })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
    });
    it('asks for a rename or skip and rejects unknown choices', async () => {
        const prompt = vi.fn(async () => 'rename');
        await expect(chooseSkillClash({ policy: 'ask', json: false, prompt })).resolves.toBe(
            'rename'
        );
        await expect(
            chooseSkillClash({ policy: 'ask', json: false, prompt: async () => 'overwrite' })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
    });
    it('uses explicit policies without prompting', async () => {
        await expect(chooseSkillClash({ policy: 'skip', json: true, prompt: null })).resolves.toBe(
            'skip'
        );
        await expect(
            chooseSkillClash({ policy: 'rename', json: true, prompt: null })
        ).resolves.toBe('rename');
    });
});
