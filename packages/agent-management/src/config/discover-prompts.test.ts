import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        readdirSync: vi.fn(),
        existsSync: vi.fn(),
    };
});

import { discoverAgentInstructionFile } from './discover-prompts.js';

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
