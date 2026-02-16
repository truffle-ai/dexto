import { patternCovers } from './pattern-utils.js';
import { describe, it, expect } from 'vitest';

describe('pattern-utils', () => {
    describe('patternCovers', () => {
        it('should match exact patterns', () => {
            expect(patternCovers('git *', 'git *')).toBe(true);
            expect(patternCovers('ls *', 'ls *')).toBe(true);
            expect(patternCovers('npm install *', 'npm install *')).toBe(true);
        });

        it('should match exact patterns without wildcard', () => {
            expect(patternCovers('git status', 'git status')).toBe(true);
        });

        it('should cover narrower pattern with broader pattern', () => {
            expect(patternCovers('git *', 'git push *')).toBe(true);
            expect(patternCovers('git *', 'git status *')).toBe(true);
            expect(patternCovers('git *', 'git commit *')).toBe(true);
        });

        it('should handle multi-level subcommands', () => {
            expect(patternCovers('docker *', 'docker compose *')).toBe(true);
            expect(patternCovers('docker compose *', 'docker compose up *')).toBe(true);
        });

        it('should not let narrower pattern cover broader pattern', () => {
            expect(patternCovers('git push *', 'git *')).toBe(false);
            expect(patternCovers('git push *', 'git status *')).toBe(false);
        });

        it('should not cross-match unrelated commands', () => {
            expect(patternCovers('npm *', 'git *')).toBe(false);
            expect(patternCovers('ls *', 'cat *')).toBe(false);
        });

        it('should not match prefixes that are not whole commands', () => {
            expect(patternCovers('npm *', 'npx *')).toBe(false);
            expect(patternCovers('git *', 'gitk *')).toBe(false);
        });

        it('should handle patterns without wildcard suffix', () => {
            expect(patternCovers('git', 'git')).toBe(true);
            expect(patternCovers('git', 'git push')).toBe(true);
            expect(patternCovers('git *', 'git')).toBe(false);
            expect(patternCovers('git', 'git *')).toBe(false);
        });
    });
});
