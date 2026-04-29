import { describe, expect, it, vi } from 'vitest';
import { CompositeSkillManager } from './skill-manager.js';
import type { SkillDocument, SkillSource, SkillSummary } from './types.js';

function source(
    id: string,
    skills: SkillSummary[],
    documents: SkillDocument[] = [],
    files: Record<string, string> = {},
    invokeResult?: SkillDocument
): SkillSource {
    return {
        id,
        list: async () => skills,
        get: vi.fn(
            async (skillId) => documents.find((document) => document.id === skillId) ?? null
        ),
        readFile: vi.fn(async (skillId, path) => {
            const content = files[`${skillId}:${path}`];
            if (content === undefined) throw new Error('missing');
            return content;
        }),
        invoke: vi.fn(async () => invokeResult ?? null),
        refresh: vi.fn(),
    };
}

describe('CompositeSkillManager', () => {
    it('lists skills from sources deterministically with first source precedence', async () => {
        const manager = new CompositeSkillManager([
            source('first', [
                { id: 'alpha', displayName: 'Alpha', description: 'First alpha' },
                { id: 'shared', displayName: 'Shared', description: 'First shared' },
            ]),
            source('second', [
                { id: 'beta', displayName: 'Beta', description: 'Second beta' },
                { id: 'shared', displayName: 'Shared', description: 'Second shared' },
            ]),
        ]);

        await expect(manager.list()).resolves.toEqual([
            { id: 'alpha', displayName: 'Alpha', description: 'First alpha' },
            { id: 'shared', displayName: 'Shared', description: 'First shared' },
            { id: 'beta', displayName: 'Beta', description: 'Second beta' },
        ]);
    });

    it('gets a skill by id or display name from the source that owns the summary', async () => {
        const alpha = {
            id: 'alpha',
            displayName: 'Alpha Skill',
            instructions: 'Use alpha.',
        };
        const manager = new CompositeSkillManager([
            source('first', [{ id: 'alpha', displayName: 'Alpha Skill' }], [alpha]),
        ]);

        await expect(manager.get('alpha')).resolves.toEqual(alpha);
        await expect(manager.get('Alpha Skill')).resolves.toEqual(alpha);
    });

    it('delegates file reads to the source that owns the skill', async () => {
        const first = source('first', [{ id: 'alpha', displayName: 'Alpha Skill' }], [], {
            'alpha:README.md': 'Alpha file',
        });
        const second = source('second', [{ id: 'beta', displayName: 'Beta Skill' }], [], {
            'beta:README.md': 'Beta file',
        });
        const manager = new CompositeSkillManager([first, second]);

        await expect(manager.readFile('Beta Skill', 'README.md')).resolves.toBe('Beta file');
        expect(first.readFile).not.toHaveBeenCalled();
        expect(second.readFile).toHaveBeenCalledWith('beta', 'README.md');
    });

    it('invokes the source-owned skill and returns its instructions', async () => {
        const invoked = {
            id: 'alpha',
            displayName: 'Alpha Skill',
            instructions: 'Use alpha with the provided args.',
        };
        const alphaSource = source(
            'first',
            [{ id: 'alpha', displayName: 'Alpha Skill' }],
            [],
            {},
            invoked
        );
        const manager = new CompositeSkillManager([alphaSource]);

        await expect(manager.invoke('Alpha Skill', { mode: 'fast' })).resolves.toEqual(invoked);
        expect(alphaSource.invoke).toHaveBeenCalledWith('alpha', { mode: 'fast' });
    });

    it('refreshes each source that supports refresh', async () => {
        const first = source('first', []);
        const second = source('second', []);
        const manager = new CompositeSkillManager([first, second]);

        await manager.refresh();

        expect(first.refresh).toHaveBeenCalledOnce();
        expect(second.refresh).toHaveBeenCalledOnce();
    });
});
