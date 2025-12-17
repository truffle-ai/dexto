import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PathValidator, DirectoryApprovalChecker } from './path-validator.js';
import type { FileSystemConfig } from './types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

describe('PathValidator', () => {
    const mockLogger = createMockLogger();
    let validator: PathValidator;
    let mockConfig: FileSystemConfig;

    beforeEach(() => {
        mockConfig = {
            allowedPaths: ['/home/user/project'],
            blockedPaths: ['.git', 'node_modules'],
            blockedExtensions: ['.exe', '.dll'],
            maxFileSize: 10 * 1024 * 1024,
            enableBackups: false,
            backupRetentionDays: 7,
            workingDirectory: '/home/user/project',
        };
        validator = new PathValidator(mockConfig, mockLogger);
    });

    describe('validatePath', () => {
        it('should validate paths within allowed directory', () => {
            const result = validator.validatePath('/home/user/project/src/file.ts');
            expect(result.isValid).toBe(true);
            expect(result.normalizedPath).toContain('project');
        });

        it('should reject paths outside allowed directory', () => {
            const result = validator.validatePath('/external/file.ts');
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('not within allowed paths');
        });

        it('should reject empty paths', () => {
            const result = validator.validatePath('');
            expect(result.isValid).toBe(false);
            expect(result.error).toBe('Path cannot be empty');
        });

        it('should reject blocked extensions', () => {
            const result = validator.validatePath('/home/user/project/malware.exe');
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('extension .exe is not allowed');
        });
    });

    describe('Directory Approval Checker Integration', () => {
        let approvalChecker: DirectoryApprovalChecker;

        beforeEach(() => {
            // Create a mock approval checker that approves /external paths
            approvalChecker = vi.fn((filePath: string) => {
                return filePath.startsWith('/external');
            });
            validator.setDirectoryApprovalChecker(approvalChecker);
        });

        it('should consult approval checker for paths outside config-allowed', () => {
            const result = validator.validatePath('/external/project/file.ts');
            expect(result.isValid).toBe(true);
            expect(approvalChecker).toHaveBeenCalledWith(expect.stringContaining('external'));
        });

        it('should not consult approval checker for paths within config-allowed', () => {
            const result = validator.validatePath('/home/user/project/src/file.ts');
            expect(result.isValid).toBe(true);
            // Checker should not be called for paths already in config
            expect(approvalChecker).not.toHaveBeenCalled();
        });

        it('should reject paths not approved by checker', () => {
            const result = validator.validatePath('/other/path/file.ts');
            expect(result.isValid).toBe(false);
            expect(approvalChecker).toHaveBeenCalled();
        });

        it('should work without approval checker set', () => {
            const validatorWithoutChecker = new PathValidator(mockConfig, mockLogger);
            const result = validatorWithoutChecker.validatePath('/external/file.ts');
            expect(result.isValid).toBe(false);
        });
    });

    describe('isPathWithinAllowed', () => {
        it('should return true for paths within allowed directory', () => {
            expect(validator.isPathWithinAllowed('/home/user/project/src/file.ts')).toBe(true);
        });

        it('should return false for paths outside allowed directory', () => {
            expect(validator.isPathWithinAllowed('/external/file.ts')).toBe(false);
        });

        it('should return false for empty paths', () => {
            expect(validator.isPathWithinAllowed('')).toBe(false);
        });

        it('should NOT consult approval checker - only checks config paths', () => {
            // This is critical: isPathWithinAllowed is used for PROMPTING decisions
            // It must ONLY check config paths, NOT the approval manager
            // Otherwise, 'once' approved paths would incorrectly skip the directory prompt
            const approvalChecker = vi.fn(() => true); // Would return true for any path
            validator.setDirectoryApprovalChecker(approvalChecker);

            // External path should return false even though checker would approve it
            expect(validator.isPathWithinAllowed('/external/file.ts')).toBe(false);

            // Approval checker should NOT be called
            expect(approvalChecker).not.toHaveBeenCalled();
        });

        it('should allow subdirectories of config-allowed paths', () => {
            expect(validator.isPathWithinAllowed('/home/user/project/deep/nested/file.ts')).toBe(
                true
            );
        });

        it('should reject sibling paths that are not children of config-allowed', () => {
            expect(validator.isPathWithinAllowed('/home/user/project-other/file.ts')).toBe(false);
        });
    });

    describe('getAllowedPaths', () => {
        it('should return configured allowed paths', () => {
            const paths = validator.getAllowedPaths();
            expect(paths).toHaveLength(1);
            expect(paths[0]).toContain('project');
        });
    });

    describe('getBlockedPaths', () => {
        it('should return configured blocked paths', () => {
            const paths = validator.getBlockedPaths();
            expect(paths).toContain('.git');
            expect(paths).toContain('node_modules');
        });
    });

    describe('Path Containment Logic', () => {
        it('should allow subdirectories of allowed path', () => {
            const result = validator.validatePath('/home/user/project/deep/nested/file.ts');
            expect(result.isValid).toBe(true);
        });

        it('should reject paths that are siblings but not children', () => {
            const result = validator.validatePath('/home/user/project-other/file.ts');
            expect(result.isValid).toBe(false);
        });
    });
});
