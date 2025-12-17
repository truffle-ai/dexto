import { describe, it, expect } from 'vitest';
import {
    DANGEROUS_COMMAND_PREFIXES,
    isDangerousCommand,
    generateBashPatternKey,
    generateBashPatternSuggestions,
    patternCovers,
} from './bash-pattern-utils.js';

describe('bash-pattern-utils', () => {
    describe('patternCovers', () => {
        describe('exact matches', () => {
            it('should match identical patterns', () => {
                expect(patternCovers('git *', 'git *')).toBe(true);
                expect(patternCovers('ls *', 'ls *')).toBe(true);
                expect(patternCovers('npm install *', 'npm install *')).toBe(true);
            });

            it('should match patterns without wildcards', () => {
                expect(patternCovers('git status', 'git status')).toBe(true);
            });
        });

        describe('broader pattern covers narrower', () => {
            it('should cover single subcommand patterns', () => {
                // "git *" covers "git push *", "git status *", etc.
                expect(patternCovers('git *', 'git push *')).toBe(true);
                expect(patternCovers('git *', 'git status *')).toBe(true);
                expect(patternCovers('git *', 'git commit *')).toBe(true);
            });

            it('should cover multi-level subcommand patterns', () => {
                // "docker *" covers "docker compose *"
                expect(patternCovers('docker *', 'docker compose *')).toBe(true);
                // "docker compose *" covers "docker compose up *"
                expect(patternCovers('docker compose *', 'docker compose up *')).toBe(true);
            });

            it('should cover npm commands', () => {
                expect(patternCovers('npm *', 'npm install *')).toBe(true);
                expect(patternCovers('npm *', 'npm run *')).toBe(true);
            });
        });

        describe('narrower pattern does NOT cover broader', () => {
            it('should not cover broader patterns', () => {
                // "git push *" does NOT cover "git *"
                expect(patternCovers('git push *', 'git *')).toBe(false);
                // "git push *" does NOT cover "git status *"
                expect(patternCovers('git push *', 'git status *')).toBe(false);
            });

            it('should not cover unrelated patterns', () => {
                expect(patternCovers('npm *', 'git *')).toBe(false);
                expect(patternCovers('ls *', 'cat *')).toBe(false);
            });
        });

        describe('similar but different commands', () => {
            it('should not match commands with similar prefixes', () => {
                // "npm *" should NOT cover "npx *" (different command)
                expect(patternCovers('npm *', 'npx *')).toBe(false);
                // "git *" should NOT cover "gitk *" (different command)
                expect(patternCovers('git *', 'gitk *')).toBe(false);
            });
        });

        describe('edge cases', () => {
            it('should handle patterns without trailing wildcard', () => {
                expect(patternCovers('git', 'git')).toBe(true);
                // Note: In practice, we always generate patterns with " *" suffix.
                // Patterns without wildcard still use the covering logic.
                expect(patternCovers('git', 'git push')).toBe(true);
            });

            it('should handle mixed patterns (wildcard vs no wildcard)', () => {
                // "git *" does NOT cover "git" (target doesn't end with " *")
                expect(patternCovers('git *', 'git')).toBe(false);
                // "git" does NOT cover "git *" (bases are "git" vs "git", exact match fails, then covering check)
                expect(patternCovers('git', 'git *')).toBe(false);
            });
        });
    });

    describe('DANGEROUS_COMMAND_PREFIXES', () => {
        it('should include common dangerous commands', () => {
            expect(DANGEROUS_COMMAND_PREFIXES).toContain('rm');
            expect(DANGEROUS_COMMAND_PREFIXES).toContain('sudo');
            expect(DANGEROUS_COMMAND_PREFIXES).toContain('chmod');
            expect(DANGEROUS_COMMAND_PREFIXES).toContain('kill');
            expect(DANGEROUS_COMMAND_PREFIXES).toContain('shutdown');
        });

        it('should be readonly', () => {
            // TypeScript enforces this at compile time
            expect(Array.isArray(DANGEROUS_COMMAND_PREFIXES)).toBe(true);
        });
    });

    describe('isDangerousCommand', () => {
        it('should return true for dangerous commands', () => {
            expect(isDangerousCommand('rm -rf /')).toBe(true);
            expect(isDangerousCommand('sudo apt install')).toBe(true);
            expect(isDangerousCommand('chmod 777 file')).toBe(true);
            expect(isDangerousCommand('kill -9 1234')).toBe(true);
            expect(isDangerousCommand('dd if=/dev/zero of=/dev/sda')).toBe(true);
        });

        it('should return false for safe commands', () => {
            expect(isDangerousCommand('ls -la')).toBe(false);
            expect(isDangerousCommand('git status')).toBe(false);
            expect(isDangerousCommand('npm install')).toBe(false);
            expect(isDangerousCommand('cat file.txt')).toBe(false);
        });

        it('should be case insensitive for command prefix', () => {
            expect(isDangerousCommand('RM -rf /')).toBe(true);
            expect(isDangerousCommand('SUDO apt install')).toBe(true);
            expect(isDangerousCommand('Chmod 777 file')).toBe(true);
        });

        it('should handle empty input', () => {
            expect(isDangerousCommand('')).toBe(false);
            expect(isDangerousCommand('   ')).toBe(false);
        });
    });

    describe('generateBashPatternKey', () => {
        describe('basic pattern generation', () => {
            it('should generate pattern for simple command', () => {
                expect(generateBashPatternKey('ls')).toBe('ls *');
            });

            it('should generate pattern for command with flags only', () => {
                // Flags don't count as subcommand
                expect(generateBashPatternKey('ls -la')).toBe('ls *');
                expect(generateBashPatternKey('ls -l -a -h')).toBe('ls *');
            });

            it('should generate pattern for command with subcommand', () => {
                expect(generateBashPatternKey('git status')).toBe('git status *');
                expect(generateBashPatternKey('git push')).toBe('git push *');
                expect(generateBashPatternKey('npm install')).toBe('npm install *');
            });

            it('should use first non-flag argument as subcommand', () => {
                // "git -v status" → git status * (flags before subcommand are skipped)
                expect(generateBashPatternKey('git -v status')).toBe('git status *');
                expect(generateBashPatternKey('npm --verbose install')).toBe('npm install *');
            });

            it('should ignore arguments after subcommand', () => {
                expect(generateBashPatternKey('git push origin main')).toBe('git push *');
                expect(generateBashPatternKey('npm install lodash --save')).toBe('npm install *');
            });
        });

        describe('dangerous commands', () => {
            it('should return null for dangerous commands', () => {
                expect(generateBashPatternKey('rm -rf /')).toBeNull();
                expect(generateBashPatternKey('sudo apt install')).toBeNull();
                expect(generateBashPatternKey('chmod 777 file')).toBeNull();
                expect(generateBashPatternKey('kill -9 1234')).toBeNull();
                expect(generateBashPatternKey('shutdown -h now')).toBeNull();
            });

            it('should be case insensitive for dangerous command detection', () => {
                expect(generateBashPatternKey('RM -rf /')).toBeNull();
                expect(generateBashPatternKey('SUDO apt install')).toBeNull();
            });
        });

        describe('edge cases', () => {
            it('should handle empty input', () => {
                expect(generateBashPatternKey('')).toBeNull();
                expect(generateBashPatternKey('   ')).toBeNull();
            });

            it('should handle extra whitespace', () => {
                expect(generateBashPatternKey('  ls   -la  ')).toBe('ls *');
                expect(generateBashPatternKey('  git   push   origin  ')).toBe('git push *');
            });

            it('should handle single command', () => {
                expect(generateBashPatternKey('pwd')).toBe('pwd *');
            });
        });
    });

    describe('generateBashPatternSuggestions', () => {
        describe('suggestion generation', () => {
            it('should generate single suggestion for simple command', () => {
                const suggestions = generateBashPatternSuggestions('ls');
                expect(suggestions).toEqual(['ls *']);
            });

            it('should generate single suggestion for command with flags only', () => {
                const suggestions = generateBashPatternSuggestions('ls -la');
                expect(suggestions).toEqual(['ls *']);
            });

            it('should generate two suggestions for command with subcommand', () => {
                const suggestions = generateBashPatternSuggestions('git push');
                expect(suggestions).toEqual(['git push *', 'git *']);
            });

            it('should generate suggestions from specific to broad', () => {
                const suggestions = generateBashPatternSuggestions('git push origin main');
                // First suggestion is the pattern key, second is broader
                expect(suggestions).toEqual(['git push *', 'git *']);
            });

            it('should handle command with flags before subcommand', () => {
                const suggestions = generateBashPatternSuggestions('npm --verbose install lodash');
                expect(suggestions).toEqual(['npm install *', 'npm *']);
            });
        });

        describe('dangerous commands', () => {
            it('should return empty array for dangerous commands', () => {
                expect(generateBashPatternSuggestions('rm -rf /')).toEqual([]);
                expect(generateBashPatternSuggestions('sudo apt install')).toEqual([]);
                expect(generateBashPatternSuggestions('chmod 777 file')).toEqual([]);
            });
        });

        describe('edge cases', () => {
            it('should handle empty input', () => {
                expect(generateBashPatternSuggestions('')).toEqual([]);
                expect(generateBashPatternSuggestions('   ')).toEqual([]);
            });

            it('should handle extra whitespace', () => {
                const suggestions = generateBashPatternSuggestions('  git   push   origin  ');
                expect(suggestions).toEqual(['git push *', 'git *']);
            });
        });
    });

    describe('integration: pattern key matches broader patterns', () => {
        // These tests verify that the pattern key generated from a command
        // can be properly matched against broader stored patterns

        it('ls and ls -la should generate the same pattern key', () => {
            expect(generateBashPatternKey('ls')).toBe(generateBashPatternKey('ls -la'));
            expect(generateBashPatternKey('ls')).toBe('ls *');
        });

        it('git push and git push origin main should generate the same pattern key', () => {
            expect(generateBashPatternKey('git push')).toBe(
                generateBashPatternKey('git push origin main')
            );
            expect(generateBashPatternKey('git push')).toBe('git push *');
        });

        it('suggestions should include the pattern key as first element', () => {
            const command = 'git push origin main';
            const patternKey = generateBashPatternKey(command);
            const suggestions = generateBashPatternSuggestions(command);

            expect(suggestions[0]).toBe(patternKey);
        });

        it('broader pattern should be able to cover narrower pattern key', () => {
            // This tests the relationship between patterns:
            // If user approves "git *", it should cover "git push *"
            const narrowKey = generateBashPatternKey('git push origin main'); // "git push *"
            const broadPattern = 'git *';

            // The narrow key's base should start with the broad pattern's base
            const narrowBase = narrowKey!.slice(0, -2); // "git push"
            const broadBase = broadPattern.slice(0, -2); // "git"

            expect(narrowBase.startsWith(broadBase + ' ')).toBe(true);
        });
    });
});
