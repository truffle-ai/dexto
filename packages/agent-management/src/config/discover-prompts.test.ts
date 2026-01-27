import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import type { Dirent } from 'fs';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        readdirSync: vi.fn(),
        existsSync: vi.fn(),
    };
});

// Mock execution context utilities
vi.mock('../utils/execution-context.js', () => ({
    getExecutionContext: vi.fn(),
    findDextoSourceRoot: vi.fn(),
    findDextoProjectRoot: vi.fn(),
}));

// Mock path utilities
vi.mock('../utils/path.js', () => ({
    getDextoGlobalPath: vi.fn((subpath: string) => `/home/user/.dexto/${subpath}`),
}));

import { discoverAgentInstructionFile, discoverCommandPrompts } from './discover-prompts.js';
import {
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
} from '../utils/execution-context.js';
import { getDextoGlobalPath } from '../utils/path.js';

describe('discoverAgentInstructionFile', () => {
    const originalCwd = process.cwd;

    beforeEach(() => {
        vi.mocked(fs.readdirSync).mockReset();
        process.cwd = vi.fn(() => '/test/project');
    });

    afterEach(() => {
        process.cwd = originalCwd;
    });

    describe('case-insensitive matching', () => {
        it('should find CLAUDE.md (uppercase)', () => {
            vi.mocked(fs.readdirSync).mockReturnValue([
                'README.md',
                'CLAUDE.md',
                'package.json',
            ] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/CLAUDE.md');
        });

        it('should find claude.md (lowercase)', () => {
            vi.mocked(fs.readdirSync).mockReturnValue([
                'README.md',
                'claude.md',
                'package.json',
            ] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/claude.md');
        });

        it('should find Claude.md (mixed case)', () => {
            vi.mocked(fs.readdirSync).mockReturnValue([
                'README.md',
                'Claude.md',
                'package.json',
            ] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/Claude.md');
        });

        it('should find AGENTS.md (uppercase)', () => {
            vi.mocked(fs.readdirSync).mockReturnValue(['AGENTS.md', 'other.txt'] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/AGENTS.md');
        });

        it('should find Gemini.md (mixed case)', () => {
            vi.mocked(fs.readdirSync).mockReturnValue(['Gemini.md', 'other.txt'] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/Gemini.md');
        });
    });

    describe('priority order', () => {
        it('should prefer AGENTS.md over CLAUDE.md', () => {
            vi.mocked(fs.readdirSync).mockReturnValue([
                'CLAUDE.md',
                'AGENTS.md',
                'GEMINI.md',
            ] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/AGENTS.md');
        });

        it('should prefer CLAUDE.md over GEMINI.md when no AGENTS.md', () => {
            vi.mocked(fs.readdirSync).mockReturnValue(['GEMINI.md', 'CLAUDE.md'] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/CLAUDE.md');
        });

        it('should return GEMINI.md when only option', () => {
            vi.mocked(fs.readdirSync).mockReturnValue(['GEMINI.md', 'other.txt'] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/GEMINI.md');
        });

        it('should prefer agents.md over claude.md (lowercase)', () => {
            vi.mocked(fs.readdirSync).mockReturnValue(['claude.md', 'agents.md'] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/agents.md');
        });
    });

    describe('no match scenarios', () => {
        it('should return null when no instruction files exist', () => {
            vi.mocked(fs.readdirSync).mockReturnValue(['README.md', 'package.json', 'src'] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBeNull();
        });

        it('should return null when directory is empty', () => {
            vi.mocked(fs.readdirSync).mockReturnValue([] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBeNull();
        });

        it('should return null when readdirSync throws', () => {
            vi.mocked(fs.readdirSync).mockImplementation(() => {
                throw new Error('ENOENT: no such file or directory');
            });

            const result = discoverAgentInstructionFile();

            expect(result).toBeNull();
        });
    });

    describe('preserves actual filename casing', () => {
        it('should return path with actual filename casing from filesystem', () => {
            // Even though we search for 'claude.md' (lowercase), the returned path
            // should use the actual casing from the filesystem
            vi.mocked(fs.readdirSync).mockReturnValue(['CLAUDE.MD'] as any);

            const result = discoverAgentInstructionFile();

            expect(result).toBe('/test/project/CLAUDE.MD');
        });
    });
});

describe('discoverCommandPrompts', () => {
    const originalCwd = process.cwd;
    const originalEnv = { ...process.env };

    // Helper to create mock Dirent objects
    const createDirent = (name: string, isFile: boolean): Dirent => ({
        name,
        isFile: () => isFile,
        isDirectory: () => !isFile,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        path: '',
        parentPath: '',
    });

    beforeEach(() => {
        vi.mocked(fs.readdirSync).mockReset();
        vi.mocked(fs.existsSync).mockReset();
        vi.mocked(getExecutionContext).mockReset();
        vi.mocked(findDextoSourceRoot).mockReset();
        vi.mocked(findDextoProjectRoot).mockReset();
        vi.mocked(getDextoGlobalPath).mockReset();

        // Default mocks
        process.cwd = vi.fn(() => '/test/project');
        process.env.HOME = '/home/user';
        process.env.DEXTO_DEV_MODE = undefined;
        vi.mocked(getExecutionContext).mockReturnValue('global-cli');
        vi.mocked(getDextoGlobalPath).mockImplementation(
            (subpath: string) => `/home/user/.dexto/${subpath}`
        );
        vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    afterEach(() => {
        process.cwd = originalCwd;
        process.env = { ...originalEnv };
    });

    describe('discovery from local .dexto/commands/', () => {
        it('should discover commands from <cwd>/.dexto/commands/', () => {
            vi.mocked(fs.existsSync).mockImplementation(
                (p) => p === '/test/project/.dexto/commands'
            );
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/commands') {
                    return [createDirent('build.md', true), createDirent('test.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/build.md',
            });
            expect(result[1]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/test.md',
            });
        });
    });

    describe('discovery from global directories', () => {
        it('should discover commands from ~/.dexto/commands/', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => p === '/home/user/.dexto/commands');
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.dexto/commands') {
                    return [createDirent('global-cmd.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/home/user/.dexto/commands/global-cmd.md',
            });
        });
    });

    describe('priority and deduplication', () => {
        it('should deduplicate by basename (case-insensitive), first found wins', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                // Local .dexto has build.md
                if (dir === '/test/project/.dexto/commands') {
                    return [createDirent('build.md', true)] as any;
                }
                // Global .dexto also has build.md
                if (dir === '/home/user/.dexto/commands') {
                    return [createDirent('build.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            // Should only have one build.md - the first one found (from local .dexto/commands)
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/build.md',
            });
        });

        it('should respect priority order: local .dexto > global .dexto', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/commands') {
                    return [createDirent('dexto-local.md', true)] as any;
                }
                if (dir === '/home/user/.dexto/commands') {
                    return [createDirent('dexto-global.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            // All unique files should be discovered in priority order
            expect(result).toHaveLength(2);
            expect(result.map((r) => r.file)).toEqual([
                '/test/project/.dexto/commands/dexto-local.md',
                '/home/user/.dexto/commands/dexto-global.md',
            ]);
        });

        it('should allow local to override global with same basename', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                // Local .dexto has deploy.md
                if (dir === '/test/project/.dexto/commands') {
                    return [createDirent('deploy.md', true)] as any;
                }
                // Global .dexto also has deploy.md
                if (dir === '/home/user/.dexto/commands') {
                    return [createDirent('deploy.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            // Local wins over global
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/deploy.md',
            });
        });
    });

    describe('dexto-source context (dev mode)', () => {
        it('should include local commands/ when DEXTO_DEV_MODE=true', () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');
            vi.mocked(findDextoSourceRoot).mockReturnValue('/dexto-source');
            process.env.DEXTO_DEV_MODE = 'true';

            vi.mocked(fs.existsSync).mockImplementation((p) => p === '/dexto-source/commands');
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/dexto-source/commands') {
                    return [createDirent('dev-command.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/dexto-source/commands/dev-command.md',
            });
        });

        it('should NOT include local commands/ when DEXTO_DEV_MODE is not set', () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');
            vi.mocked(findDextoSourceRoot).mockReturnValue('/dexto-source');
            process.env.DEXTO_DEV_MODE = undefined;

            vi.mocked(fs.existsSync).mockImplementation(
                (p) => p === '/dexto-source/commands' || p === '/test/project/.dexto/commands'
            );
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/dexto-source/commands') {
                    return [createDirent('dev-command.md', true)] as any;
                }
                if (dir === '/test/project/.dexto/commands') {
                    return [createDirent('local-dexto.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            // Should not include dev-command.md, but should include local .dexto/commands
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/local-dexto.md',
            });
        });
    });

    describe('dexto-project context', () => {
        it('should include local commands/ from project root', () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-project');
            vi.mocked(findDextoProjectRoot).mockReturnValue('/my-dexto-project');

            vi.mocked(fs.existsSync).mockImplementation((p) => p === '/my-dexto-project/commands');
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/my-dexto-project/commands') {
                    return [createDirent('project-cmd.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/my-dexto-project/commands/project-cmd.md',
            });
        });
    });

    describe('file filtering', () => {
        it('should only include .md files', () => {
            vi.mocked(fs.existsSync).mockImplementation(
                (p) => p === '/test/project/.dexto/commands'
            );
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/commands') {
                    return [
                        createDirent('command.md', true),
                        createDirent('script.sh', true),
                        createDirent('config.json', true),
                        createDirent('another.md', true),
                    ] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            expect(result).toHaveLength(2);
            expect(result.map((r) => r.file)).toEqual([
                '/test/project/.dexto/commands/command.md',
                '/test/project/.dexto/commands/another.md',
            ]);
        });

        it('should exclude README.md', () => {
            vi.mocked(fs.existsSync).mockImplementation(
                (p) => p === '/test/project/.dexto/commands'
            );
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/commands') {
                    return [
                        createDirent('README.md', true),
                        createDirent('command.md', true),
                    ] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/command.md',
            });
        });

        it('should exclude directories', () => {
            vi.mocked(fs.existsSync).mockImplementation(
                (p) => p === '/test/project/.dexto/commands'
            );
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/commands') {
                    return [
                        createDirent('command.md', true),
                        createDirent('subdir', false), // directory
                    ] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/command.md',
            });
        });
    });

    describe('edge cases', () => {
        it('should return empty array when no command directories exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = discoverCommandPrompts();

            expect(result).toEqual([]);
        });

        it('should handle missing HOME environment variable', () => {
            delete process.env.HOME;
            delete process.env.USERPROFILE;

            vi.mocked(fs.existsSync).mockImplementation(
                (p) => p === '/test/project/.dexto/commands'
            );
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/commands') {
                    return [createDirent('local.md', true)] as any;
                }
                return [];
            });

            const result = discoverCommandPrompts();

            // Should still work for local commands
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'file',
                file: '/test/project/.dexto/commands/local.md',
            });
        });

        it('should handle errors reading directories gracefully', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockImplementation(() => {
                throw new Error('Permission denied');
            });

            const result = discoverCommandPrompts();

            // Should return empty array, not throw
            expect(result).toEqual([]);
        });
    });
});
