import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceScaffold, handleInitCommand } from './init.js';

const { mockIntro, mockNote, mockOutro } = vi.hoisted(() => ({
    mockIntro: vi.fn(),
    mockNote: vi.fn(),
    mockOutro: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    intro: mockIntro,
    note: mockNote,
    outro: mockOutro,
}));

describe('init command', () => {
    let tempDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-init-workspace-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('creates AGENTS.md plus authored agents and skills directories', async () => {
        const result = await createWorkspaceScaffold(tempDir);

        expect(result.root).toBe(tempDir);
        expect(result.agentsFile.status).toBe('created');
        expect(result.directories).toEqual([
            { path: path.join(tempDir, 'agents'), status: 'created' },
            { path: path.join(tempDir, 'skills'), status: 'created' },
        ]);

        const agentsMd = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf8');
        expect(agentsMd).toContain('# Dexto Workspace');
        expect(agentsMd).toContain('agents/');
        expect(agentsMd).toContain('skills/<skill-id>/SKILL.md');
        expect(agentsMd).toContain('.dexto/');

        expect((await fs.stat(path.join(tempDir, 'agents'))).isDirectory()).toBe(true);
        expect((await fs.stat(path.join(tempDir, 'skills'))).isDirectory()).toBe(true);
    });

    it('does not overwrite an existing AGENTS.md file', async () => {
        const customAgentsMd = '# Custom Workspace\n';
        await fs.writeFile(path.join(tempDir, 'AGENTS.md'), customAgentsMd, 'utf8');

        const result = await createWorkspaceScaffold(tempDir);

        expect(result.agentsFile.status).toBe('existing');
        expect(result.directories).toEqual([
            { path: path.join(tempDir, 'agents'), status: 'created' },
            { path: path.join(tempDir, 'skills'), status: 'created' },
        ]);
        await expect(fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf8')).resolves.toBe(
            customAgentsMd
        );
    });

    it('fails without partial writes when a scaffold path conflicts with a file', async () => {
        await fs.writeFile(path.join(tempDir, 'agents'), 'not a directory', 'utf8');

        await expect(createWorkspaceScaffold(tempDir)).rejects.toThrow(
            `${path.join(tempDir, 'agents')} exists and is not a directory`
        );

        await expect(fs.access(path.join(tempDir, 'AGENTS.md'))).rejects.toThrow();
        await expect(fs.access(path.join(tempDir, 'skills'))).rejects.toThrow();
    });

    it('reports when the workspace is already initialized', async () => {
        await createWorkspaceScaffold(tempDir);

        await handleInitCommand(tempDir);

        expect(mockIntro).toHaveBeenCalledTimes(1);
        expect(mockNote).not.toHaveBeenCalled();
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('Workspace already initialized.')
        );
    });
});
