import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        readdirSync: vi.fn(),
    };
});

import { discoverStandaloneSkills, getSkillSearchPaths } from './discover-skills.js';

type MockDirent = {
    name: string;
    isDirectory: () => boolean;
};

describe('discoverStandaloneSkills', () => {
    const originalCwd = process.cwd;
    const originalEnv = { ...process.env };

    const createDirent = (name: string, isDirectory: boolean): MockDirent => ({
        name,
        isDirectory: () => isDirectory,
    });

    beforeEach(() => {
        vi.resetAllMocks();
        process.cwd = vi.fn(() => '/test/project');
        process.env.HOME = '/home/user';
        process.env.USERPROFILE = '/home/user';
    });

    afterEach(() => {
        process.cwd = originalCwd;
        process.env = { ...originalEnv };
    });

    it('discovers user skills from the canonical ~/.agents/skills root', () => {
        vi.mocked(fs.existsSync).mockImplementation((entry) => {
            const value = String(entry);
            return (
                value === '/home/user/.agents/skills' ||
                value === '/home/user/.agents/skills/review/SKILL.md'
            );
        });
        vi.mocked(fs.readdirSync).mockImplementation((entry) => {
            if (String(entry) === '/home/user/.agents/skills') {
                return [createDirent('review', true)] as unknown as ReturnType<
                    typeof fs.readdirSync
                >;
            }
            return [];
        });

        expect(discoverStandaloneSkills()).toEqual([
            {
                name: 'review',
                path: '/home/user/.agents/skills/review',
                skillFile: '/home/user/.agents/skills/review/SKILL.md',
                source: 'user',
            },
        ]);
    });

    it('prioritizes project skills over user skills with the same name', () => {
        vi.mocked(fs.existsSync).mockImplementation((entry) => {
            const value = String(entry);
            return (
                value === '/test/project/.agents/skills' ||
                value === '/test/project/.agents/skills/review/SKILL.md' ||
                value === '/home/user/.agents/skills' ||
                value === '/home/user/.agents/skills/review/SKILL.md'
            );
        });
        vi.mocked(fs.readdirSync).mockImplementation((entry) => {
            const value = String(entry);
            if (value === '/test/project/.agents/skills') {
                return [createDirent('review', true)] as unknown as ReturnType<
                    typeof fs.readdirSync
                >;
            }
            if (value === '/home/user/.agents/skills') {
                return [createDirent('review', true)] as unknown as ReturnType<
                    typeof fs.readdirSync
                >;
            }
            return [];
        });

        const result = discoverStandaloneSkills();

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            name: 'review',
            path: '/test/project/.agents/skills/review',
            source: 'project',
        });
    });

    it('preserves legacy project and user skill roots for compatibility', () => {
        vi.mocked(fs.existsSync).mockImplementation((entry) => {
            const value = String(entry);
            return (
                value === '/test/project/skills' ||
                value === '/test/project/skills/legacy-project/SKILL.md' ||
                value === '/test/project/.dexto/skills' ||
                value === '/test/project/.dexto/skills/legacy-dexto/SKILL.md' ||
                value === '/home/user/.dexto/skills' ||
                value === '/home/user/.dexto/skills/legacy-user/SKILL.md'
            );
        });
        vi.mocked(fs.readdirSync).mockImplementation((entry) => {
            const value = String(entry);
            if (value === '/test/project/skills') {
                return [createDirent('legacy-project', true)] as unknown as ReturnType<
                    typeof fs.readdirSync
                >;
            }
            if (value === '/test/project/.dexto/skills') {
                return [createDirent('legacy-dexto', true)] as unknown as ReturnType<
                    typeof fs.readdirSync
                >;
            }
            if (value === '/home/user/.dexto/skills') {
                return [createDirent('legacy-user', true)] as unknown as ReturnType<
                    typeof fs.readdirSync
                >;
            }
            return [];
        });

        expect(discoverStandaloneSkills().map((skill) => skill.name)).toEqual([
            'legacy-project',
            'legacy-dexto',
            'legacy-user',
        ]);
    });

    it('skips incomplete and non-directory entries', () => {
        vi.mocked(fs.existsSync).mockImplementation((entry) => {
            const value = String(entry);
            return (
                value === '/home/user/.agents/skills' ||
                value === '/home/user/.agents/skills/valid/SKILL.md'
            );
        });
        vi.mocked(fs.readdirSync).mockImplementation((entry) => {
            if (String(entry) === '/home/user/.agents/skills') {
                return [
                    createDirent('valid', true),
                    createDirent('incomplete', true),
                    createDirent('not-a-directory.md', false),
                ] as unknown as ReturnType<typeof fs.readdirSync>;
            }
            return [];
        });

        expect(discoverStandaloneSkills().map((skill) => skill.name)).toEqual(['valid']);
    });

    it('still discovers project skills when HOME is unavailable', () => {
        delete process.env.HOME;
        delete process.env.USERPROFILE;
        vi.mocked(fs.existsSync).mockImplementation((entry) => {
            const value = String(entry);
            return (
                value === '/test/project/.agents/skills' ||
                value === '/test/project/.agents/skills/local/SKILL.md'
            );
        });
        vi.mocked(fs.readdirSync).mockImplementation((entry) => {
            if (String(entry) === '/test/project/.agents/skills') {
                return [createDirent('local', true)] as unknown as ReturnType<
                    typeof fs.readdirSync
                >;
            }
            return [];
        });

        expect(discoverStandaloneSkills()).toHaveLength(1);
    });

    it('falls back to the operating-system home directory when env vars are unavailable', () => {
        delete process.env.HOME;
        delete process.env.USERPROFILE;

        expect(getSkillSearchPaths()).toContain(path.join(homedir(), '.agents', 'skills'));
    });
});

describe('getSkillSearchPaths', () => {
    const originalCwd = process.cwd;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.cwd = vi.fn(() => '/test/project');
        process.env.HOME = '/home/user';
    });

    afterEach(() => {
        process.cwd = originalCwd;
        process.env = { ...originalEnv };
    });

    it('returns canonical and legacy roots in priority order', () => {
        expect(getSkillSearchPaths()).toEqual([
            '/test/project/.agents/skills',
            '/test/project/skills',
            '/test/project/.dexto/skills',
            '/home/user/.agents/skills',
            '/home/user/.dexto/skills',
        ]);
    });

    it('uses an explicit project path for the project root', () => {
        expect(getSkillSearchPaths('/other/project')).toEqual([
            '/other/project/.agents/skills',
            '/other/project/skills',
            '/other/project/.dexto/skills',
            '/home/user/.agents/skills',
            '/home/user/.dexto/skills',
        ]);
    });
});
