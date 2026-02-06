import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        readdirSync: vi.fn(),
    };
});

import { discoverStandaloneSkills, getSkillSearchPaths } from './discover-skills.js';

// Mock Dirent type that matches fs.Dirent interface
interface MockDirent
    extends Pick<
        fs.Dirent,
        | 'name'
        | 'isFile'
        | 'isDirectory'
        | 'isBlockDevice'
        | 'isCharacterDevice'
        | 'isSymbolicLink'
        | 'isFIFO'
        | 'isSocket'
        | 'path'
        | 'parentPath'
    > {}

describe('discoverStandaloneSkills', () => {
    const originalCwd = process.cwd;
    const originalEnv = { ...process.env };

    // Helper to create mock Dirent-like objects
    const createDirent = (name: string, isDir: boolean): MockDirent => ({
        name,
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        path: '',
        parentPath: '',
    });

    beforeEach(() => {
        vi.resetAllMocks();
        process.cwd = vi.fn(() => '/test/project');
        process.env.HOME = '/home/user';
    });

    afterEach(() => {
        process.cwd = originalCwd;
        process.env = { ...originalEnv };
    });

    describe('skill discovery from user directory', () => {
        it('should discover skills from ~/.agents/skills/', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.agents/skills') return true;
                if (p === '/home/user/.agents/skills/remotion-video/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.agents/skills') {
                    return [createDirent('remotion-video', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                name: 'remotion-video',
                path: '/home/user/.agents/skills/remotion-video',
                skillFile: '/home/user/.agents/skills/remotion-video/SKILL.md',
                source: 'user',
            });
        });

        it('should discover skills from ~/.dexto/skills/', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/skills') return true;
                if (p === '/home/user/.dexto/skills/remotion-video/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.dexto/skills') {
                    return [createDirent('remotion-video', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                name: 'remotion-video',
                path: '/home/user/.dexto/skills/remotion-video',
                skillFile: '/home/user/.dexto/skills/remotion-video/SKILL.md',
                source: 'user',
            });
        });

        it('should skip directories without SKILL.md', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/skills') return true;
                // SKILL.md does not exist
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.dexto/skills') {
                    return [createDirent('incomplete-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(0);
        });
    });

    describe('skill discovery from project directory', () => {
        it('should discover skills from <cwd>/.agents/skills/', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.agents/skills') return true;
                if (p === '/test/project/.agents/skills/my-project-skill/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.agents/skills') {
                    return [createDirent('my-project-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                name: 'my-project-skill',
                source: 'project',
            });
        });

        it('should discover skills from <cwd>/.dexto/skills/', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/skills') return true;
                if (p === '/test/project/.dexto/skills/my-project-skill/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/skills') {
                    return [createDirent('my-project-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                name: 'my-project-skill',
                source: 'project',
            });
        });

        it('should prioritize project skills over user skills with same name', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/skills') return true;
                if (p === '/test/project/.dexto/skills/shared-skill/SKILL.md') return true;
                if (p === '/home/user/.dexto/skills') return true;
                if (p === '/home/user/.dexto/skills/shared-skill/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/skills') {
                    return [createDirent('shared-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                if (dir === '/home/user/.dexto/skills') {
                    return [createDirent('shared-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            // Should only have one skill (project takes priority)
            expect(result).toHaveLength(1);
            expect(result[0]!.source).toBe('project');
            expect(result[0]!.path).toBe('/test/project/.dexto/skills/shared-skill');
        });

        it('should prefer .agents over .dexto skills with same name', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.agents/skills') return true;
                if (p === '/test/project/.agents/skills/shared-skill/SKILL.md') return true;
                if (p === '/test/project/.dexto/skills') return true;
                if (p === '/test/project/.dexto/skills/shared-skill/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.agents/skills') {
                    return [createDirent('shared-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                if (dir === '/test/project/.dexto/skills') {
                    return [createDirent('shared-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(1);
            expect(result[0]!.path).toBe('/test/project/.agents/skills/shared-skill');
        });
    });

    describe('edge cases', () => {
        it('should return empty array when no skills directories exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = discoverStandaloneSkills();

            expect(result).toEqual([]);
        });

        it('should skip non-directory entries', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/skills') return true;
                if (p === '/home/user/.dexto/skills/valid-skill/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.dexto/skills') {
                    return [
                        createDirent('valid-skill', true),
                        createDirent('some-file.md', false), // File, not directory
                    ] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe('valid-skill');
        });

        it('should handle missing HOME environment variable', () => {
            delete process.env.HOME;
            delete process.env.USERPROFILE;

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/skills') return true;
                if (p === '/test/project/.dexto/skills/local-skill/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/skills') {
                    return [createDirent('local-skill', true)] as unknown as ReturnType<
                        typeof fs.readdirSync
                    >;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            // Should still work for project skills
            expect(result).toHaveLength(1);
        });

        it('should discover multiple skills from same directory', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/skills') return true;
                if (p === '/home/user/.dexto/skills/skill-a/SKILL.md') return true;
                if (p === '/home/user/.dexto/skills/skill-b/SKILL.md') return true;
                if (p === '/home/user/.dexto/skills/skill-c/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.dexto/skills') {
                    return [
                        createDirent('skill-a', true),
                        createDirent('skill-b', true),
                        createDirent('skill-c', true),
                    ] as unknown as ReturnType<typeof fs.readdirSync>;
                }
                return [];
            });

            const result = discoverStandaloneSkills();

            expect(result).toHaveLength(3);
            expect(result.map((s) => s.name).sort()).toEqual(['skill-a', 'skill-b', 'skill-c']);
        });
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

    it('should return all search paths in priority order', () => {
        const paths = getSkillSearchPaths();

        expect(paths).toEqual([
            '/test/project/.agents/skills',
            '/test/project/.dexto/skills',
            '/home/user/.agents/skills',
            '/home/user/.dexto/skills',
        ]);
    });
});
