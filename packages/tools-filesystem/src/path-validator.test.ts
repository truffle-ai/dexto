/**
 * PathValidator Unit Tests
 *
 * Tests for path validation, security checks, and allowed path logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PathValidator, DirectoryApprovalChecker } from './path-validator.js';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('PathValidator', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;

    beforeEach(() => {
        mockLogger = createMockLogger();
        vi.clearAllMocks();
    });

    describe('validatePath', () => {
        describe('Empty and Invalid Paths', () => {
            it('should reject empty path', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('');
                expect(result.isValid).toBe(false);
                expect(result.error).toBe('Path cannot be empty');
            });

            it('should reject whitespace-only path', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('   ');
                expect(result.isValid).toBe(false);
                expect(result.error).toBe('Path cannot be empty');
            });
        });

        describe('Allowed Paths', () => {
            it('should allow paths within allowed directories', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('/home/user/project/src/file.ts');
                expect(result.isValid).toBe(true);
                expect(result.normalizedPath).toBeDefined();
            });

            it('should allow relative paths within working directory', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('src/file.ts');
                expect(result.isValid).toBe(true);
            });

            it('should reject paths outside allowed directories', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('/external/project/file.ts');
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('not within allowed paths');
            });

            it('should allow all paths when allowedPaths is empty', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: [],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('/anywhere/file.ts');
                expect(result.isValid).toBe(true);
            });
        });

        describe('Path Traversal Detection', () => {
            it('should reject path traversal attempts', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath(
                    '/home/user/project/../../../etc/passwd'
                );
                expect(result.isValid).toBe(false);
                expect(result.error).toBe('Path traversal detected');
            });
        });

        describe('Blocked Paths', () => {
            it('should reject paths in blocked directories', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: ['.git', 'node_modules'],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('/home/user/project/.git/config');
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('blocked');
            });

            it('should reject paths in node_modules', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: ['node_modules'],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath(
                    '/home/user/project/node_modules/lodash/index.js'
                );
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('blocked');
            });
        });

        describe('Blocked Extensions', () => {
            it('should reject files with blocked extensions', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: ['.exe', '.dll'],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('/home/user/project/malware.exe');
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('.exe is not allowed');
            });

            it('should handle extensions without leading dot', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: ['exe', 'dll'], // No leading dot
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('/home/user/project/file.exe');
                expect(result.isValid).toBe(false);
            });

            it('should be case-insensitive for extensions', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: ['.exe'],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                const result = await validator.validatePath('/home/user/project/file.EXE');
                expect(result.isValid).toBe(false);
            });
        });

        describe('Directory Approval Checker Integration', () => {
            it('should consult approval checker for external paths', async () => {
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );

                // Without approval checker, external path should fail
                let result = await validator.validatePath('/external/project/file.ts');
                expect(result.isValid).toBe(false);

                // Set approval checker that approves external path
                const approvalChecker: DirectoryApprovalChecker = (filePath) => {
                    return filePath.startsWith('/external/project');
                };
                validator.setDirectoryApprovalChecker(approvalChecker);

                // Now external path should succeed
                result = await validator.validatePath('/external/project/file.ts');
                expect(result.isValid).toBe(true);
            });

            it('should not use approval checker for config-allowed paths', async () => {
                const approvalChecker = vi.fn().mockReturnValue(false);
                const validator = new PathValidator(
                    {
                        allowedPaths: ['/home/user/project'],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        enableBackups: false,
                        backupRetentionDays: 7,
                        workingDirectory: '/home/user/project',
                    },
                    mockLogger as any
                );
                validator.setDirectoryApprovalChecker(approvalChecker);

                // Config-allowed path should not invoke checker
                const result = await validator.validatePath('/home/user/project/src/file.ts');
                expect(result.isValid).toBe(true);
                expect(approvalChecker).not.toHaveBeenCalled();
            });
        });
    });

    describe('isPathWithinAllowed', () => {
        it('should return true for paths within config-allowed directories', async () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['/home/user/project'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            expect(await validator.isPathWithinAllowed('/home/user/project/src/file.ts')).toBe(
                true
            );
            expect(
                await validator.isPathWithinAllowed('/home/user/project/deep/nested/file.ts')
            ).toBe(true);
        });

        it('should return false for paths outside config-allowed directories', async () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['/home/user/project'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            expect(await validator.isPathWithinAllowed('/external/project/file.ts')).toBe(false);
            expect(await validator.isPathWithinAllowed('/home/user/other/file.ts')).toBe(false);
        });

        it('should NOT consult approval checker (used for prompting decisions)', async () => {
            const approvalChecker = vi.fn().mockReturnValue(true);
            const validator = new PathValidator(
                {
                    allowedPaths: ['/home/user/project'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );
            validator.setDirectoryApprovalChecker(approvalChecker);

            // Even with approval checker that returns true, isPathWithinAllowed should return false
            // for external paths (it only checks config paths, not approval checker)
            expect(await validator.isPathWithinAllowed('/external/project/file.ts')).toBe(false);
            expect(approvalChecker).not.toHaveBeenCalled();
        });

        it('should return false for empty path', async () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['/home/user/project'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            expect(await validator.isPathWithinAllowed('')).toBe(false);
            expect(await validator.isPathWithinAllowed('   ')).toBe(false);
        });

        it('should return true when allowedPaths is empty (all paths allowed)', async () => {
            const validator = new PathValidator(
                {
                    allowedPaths: [],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            expect(await validator.isPathWithinAllowed('/anywhere/file.ts')).toBe(true);
        });
    });

    describe('Path Containment (Parent Directory Coverage)', () => {
        it('should recognize that approving parent covers child paths', async () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['/external/sub'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            // Child path of allowed directory
            expect(await validator.isPathWithinAllowed('/external/sub/deep/nested/file.ts')).toBe(
                true
            );
        });

        it('should not allow sibling directories', async () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['/external/sub'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            // /external/other is sibling, not child
            expect(await validator.isPathWithinAllowed('/external/other/file.ts')).toBe(false);
        });

        it('should not allow parent directories when child is approved', async () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['/external/sub/deep'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            // /external/sub is parent, should not be allowed
            expect(await validator.isPathWithinAllowed('/external/sub/file.ts')).toBe(false);
        });
    });

    describe('getAllowedPaths and getBlockedPaths', () => {
        it('should return normalized allowed paths', () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['.', './src'],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            const allowedPaths = validator.getAllowedPaths();
            expect(allowedPaths).toHaveLength(2);
            expect(allowedPaths[0]).toBe('/home/user/project');
            expect(allowedPaths[1]).toBe('/home/user/project/src');
        });

        it('should return blocked paths', () => {
            const validator = new PathValidator(
                {
                    allowedPaths: ['/home/user/project'],
                    blockedPaths: ['.git', 'node_modules'],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    enableBackups: false,
                    backupRetentionDays: 7,
                    workingDirectory: '/home/user/project',
                },
                mockLogger as any
            );

            const blockedPaths = validator.getBlockedPaths();
            expect(blockedPaths).toContain('.git');
            expect(blockedPaths).toContain('node_modules');
        });
    });
});
