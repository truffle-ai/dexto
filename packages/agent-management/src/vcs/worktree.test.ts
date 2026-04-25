import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockExecFileAsync } = vi.hoisted(() => ({
    mockExecFileAsync: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();
    return {
        ...actual,
        execFile: mockExecFileAsync,
    };
});

vi.mock('util', async (importOriginal) => {
    const actual = await importOriginal<typeof import('util')>();
    return {
        ...actual,
        promisify: () => mockExecFileAsync,
    };
});

import { hasUnstagedChanges } from './worktree.js';

describe('hasUnstagedChanges', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    });

    it('returns true for unstaged modification (" M")', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: ' M file.txt\n', stderr: '' });
        expect(await hasUnstagedChanges('/some/path')).toBe(true);
    });

    it('returns true for unstaged deletion (" D")', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: ' D deleted-file.txt\n', stderr: '' });
        expect(await hasUnstagedChanges('/some/path')).toBe(true);
    });

    it('returns false for staged-only modification ("M ")', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: 'M  file.txt\n', stderr: '' });
        expect(await hasUnstagedChanges('/some/path')).toBe(false);
    });

    it('returns true for untracked file ("??")', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '?? new-file.txt\n', stderr: '' });
        expect(await hasUnstagedChanges('/some/path')).toBe(true);
    });

    it('returns true when both staged and unstaged changes exist', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: 'M  file1.txt\n M file2.txt\n', stderr: '' });
        expect(await hasUnstagedChanges('/some/path')).toBe(true);
    });

    it('returns false for clean working tree', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
        expect(await hasUnstagedChanges('/some/path')).toBe(false);
    });

    it('returns true for multiple unstaged changes', async () => {
        mockExecFileAsync.mockResolvedValue({
            stdout: ' M file1.txt\n M file2.txt\n?? new-file.txt\n',
            stderr: '',
        });
        expect(await hasUnstagedChanges('/some/path')).toBe(true);
    });

    it('passes correct cwd to git command', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
        await hasUnstagedChanges('/my/worktree/path');
        expect(mockExecFileAsync).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
            cwd: '/my/worktree/path',
        });
    });
});
