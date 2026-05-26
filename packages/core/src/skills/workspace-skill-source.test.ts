import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSkillSource } from './workspace-skill-source.js';
import type { WorkspaceManager } from '../workspace/index.js';
import type { WorkspaceContext } from '../workspace/types.js';

const workspaceContext: WorkspaceContext = {
    id: 'workspace-id',
    path: '/workspace',
    createdAt: 1,
    lastActiveAt: 1,
};

function createWorkspaceManager(files: Record<string, string>) {
    return {
        getWorkspace: vi.fn(async () => workspaceContext),
        open: vi.fn(async () => ({
            context: workspaceContext,
            capabilities: ['files' as const],
            files: {
                readFile: vi.fn(async (path: string) => files[path] ?? ''),
                glob: vi.fn(async (pattern: string) =>
                    Object.keys(files).filter((path) => {
                        if (pattern === '.agents/skills/*/SKILL.md') {
                            return /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(path);
                        }
                        if (pattern === 'skills/*/SKILL.md') {
                            return /^skills\/[^/]+\/SKILL\.md$/.test(path);
                        }
                        if (pattern === '.dexto/skills/*/SKILL.md') {
                            return /^\.dexto\/skills\/[^/]+\/SKILL\.md$/.test(path);
                        }
                        return false;
                    })
                ),
                readText: vi.fn(async (path: string) => files[path] ?? ''),
                writeFile: vi.fn(async (path: string, content: string) => {
                    files[path] = content;
                }),
                listFiles: vi.fn(async () => Object.keys(files)),
            },
        })),
    };
}

describe('WorkspaceSkillSource', () => {
    it('lists repo-local skills from known workspace roots', async () => {
        const workspaceManager = createWorkspaceManager({
            '.agents/skills/review/SKILL.md': '# Code Review\n\nReview code carefully.',
            'skills/debug/SKILL.md': '# Debugging\n\nFind root causes.',
        });
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.list()).resolves.toEqual([
            { id: 'review', displayName: 'Code Review' },
            { id: 'debug', displayName: 'Debugging' },
        ]);
        expect(workspaceManager.open).toHaveBeenCalledWith({ intent: 'read' });
    });

    it('gets skill instructions from SKILL.md', async () => {
        const workspaceManager = createWorkspaceManager({
            '.agents/skills/review/SKILL.md': '# Code Review\n\nReview code carefully.',
        });
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.get('review')).resolves.toEqual({
            id: 'review',
            displayName: 'Code Review',
            instructions: '# Code Review\n\nReview code carefully.',
        });
    });

    it('reads files relative to the skill directory', async () => {
        const workspaceManager = createWorkspaceManager({
            '.agents/skills/review/SKILL.md': '# Code Review\n\nReview code carefully.',
            '.agents/skills/review/references/checklist.md': 'Check tests.',
        });
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.readFile('review', 'references/checklist.md')).resolves.toBe(
            'Check tests.'
        );
    });

    it('uses directory id as fallback display name and reads frontmatter description', async () => {
        const workspaceManager = createWorkspaceManager({
            'skills/no-heading/SKILL.md': '---\ndescription: Helps without a heading\n---\n\nBody.',
        });
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.list()).resolves.toEqual([
            {
                id: 'no-heading',
                displayName: 'no-heading',
                description: 'Helps without a heading',
            },
        ]);
    });

    it('refresh clears cached discovery results', async () => {
        const files: Record<string, string> = {
            '.agents/skills/review/SKILL.md': '# Code Review\n\nReview code carefully.',
        };
        const workspaceManager = createWorkspaceManager(files);
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.list()).resolves.toEqual([
            { id: 'review', displayName: 'Code Review' },
        ]);

        files['skills/debug/SKILL.md'] = '# Debugging\n\nFind root causes.';
        await source.refresh();

        await expect(source.list()).resolves.toEqual([
            { id: 'review', displayName: 'Code Review' },
            { id: 'debug', displayName: 'Debugging' },
        ]);
    });

    it('fails clearly when workspace file capability is misconfigured', async () => {
        const workspaceManager = {
            getWorkspace: vi.fn(async () => workspaceContext),
            open: vi.fn(async () => ({
                context: workspaceContext,
                capabilities: ['files' as const],
                files: {},
            })),
        } as unknown as Pick<WorkspaceManager, 'getWorkspace' | 'open'>;
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.list()).rejects.toThrow(
            'Workspace file capability requires glob and readText'
        );
    });

    it('returns no skills when there is no active workspace', async () => {
        const workspaceManager = {
            getWorkspace: vi.fn(async () => null),
            open: vi.fn(),
        } as unknown as Pick<WorkspaceManager, 'getWorkspace' | 'open'>;
        const source = new WorkspaceSkillSource(workspaceManager);

        await expect(source.list()).resolves.toEqual([]);
        expect(workspaceManager.open).not.toHaveBeenCalled();
    });
});
