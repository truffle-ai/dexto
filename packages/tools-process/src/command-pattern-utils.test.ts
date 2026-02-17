import {
    generateCommandPatternKey,
    generateCommandPatternSuggestions,
    isDangerousCommand,
} from './command-pattern-utils.js';
import { describe, it, expect } from 'vitest';

describe('command-pattern-utils', () => {
    describe('isDangerousCommand', () => {
        it('should detect dangerous commands', () => {
            expect(isDangerousCommand('rm -rf /')).toBe(true);
            expect(isDangerousCommand('sudo apt install')).toBe(true);
            expect(isDangerousCommand('chmod 777 file')).toBe(true);
            expect(isDangerousCommand('kill -9 1234')).toBe(true);
            expect(isDangerousCommand('dd if=/dev/zero of=/dev/sda')).toBe(true);
        });

        it('should not flag safe commands', () => {
            expect(isDangerousCommand('ls -la')).toBe(false);
            expect(isDangerousCommand('git status')).toBe(false);
            expect(isDangerousCommand('npm install')).toBe(false);
            expect(isDangerousCommand('cat file.txt')).toBe(false);
        });

        it('should be case-insensitive', () => {
            expect(isDangerousCommand('RM -rf /')).toBe(true);
            expect(isDangerousCommand('SUDO apt install')).toBe(true);
            expect(isDangerousCommand('Chmod 777 file')).toBe(true);
        });

        it('should handle empty input', () => {
            expect(isDangerousCommand('')).toBe(false);
            expect(isDangerousCommand('   ')).toBe(false);
        });
    });

    describe('generateCommandPatternKey', () => {
        it('should generate patterns for simple commands', () => {
            expect(generateCommandPatternKey('ls')).toBe('ls *');
            expect(generateCommandPatternKey('pwd')).toBe('pwd *');
        });

        it('should ignore flags when choosing subcommand', () => {
            expect(generateCommandPatternKey('ls -la')).toBe('ls *');
            expect(generateCommandPatternKey('git -v status')).toBe('git status *');
            expect(generateCommandPatternKey('npm --verbose install')).toBe('npm install *');
        });

        it('should generate subcommand patterns', () => {
            expect(generateCommandPatternKey('git status')).toBe('git status *');
            expect(generateCommandPatternKey('git push origin main')).toBe('git push *');
        });

        it('should return null for dangerous commands', () => {
            expect(generateCommandPatternKey('rm -rf /')).toBeNull();
            expect(generateCommandPatternKey('sudo apt install')).toBeNull();
            expect(generateCommandPatternKey('shutdown -h now')).toBeNull();
        });

        it('should handle empty input', () => {
            expect(generateCommandPatternKey('')).toBeNull();
            expect(generateCommandPatternKey('   ')).toBeNull();
        });

        it('should trim and normalize whitespace', () => {
            expect(generateCommandPatternKey('  ls   -la  ')).toBe('ls *');
            expect(generateCommandPatternKey('  git   push   origin  ')).toBe('git push *');
        });
    });

    describe('generateCommandPatternSuggestions', () => {
        it('should generate broad-to-narrow suggestions', () => {
            expect(generateCommandPatternSuggestions('ls')).toEqual(['ls *']);
            expect(generateCommandPatternSuggestions('git push origin main')).toEqual([
                'git push *',
                'git *',
            ]);
        });

        it('should return empty for dangerous commands', () => {
            expect(generateCommandPatternSuggestions('rm -rf /')).toEqual([]);
        });

        it('should handle empty input', () => {
            expect(generateCommandPatternSuggestions('')).toEqual([]);
            expect(generateCommandPatternSuggestions('   ')).toEqual([]);
        });

        it('should keep suggestions consistent with pattern key', () => {
            const command = 'git push origin main';
            const patternKey = generateCommandPatternKey(command);
            const suggestions = generateCommandPatternSuggestions(command);

            expect(patternKey).toBe('git push *');
            expect(suggestions[0]).toBe(patternKey);
        });
    });
});
