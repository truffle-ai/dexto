/**
 * FileSystemService Tests
 *
 * Tests for the core filesystem service including backup behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { FileSystemService } from './filesystem-service.js';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('FileSystemService', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-fs-test-'));
        tempDir = await fs.realpath(rawTempDir);

        vi.clearAllMocks();
    });

    afterEach(async () => {
        // Cleanup temp directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('Backup Behavior', () => {
        describe('writeFile', () => {
            it('should NOT create backup when enableBackups is false (default)', async () => {
                const fileSystemService = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: false,
                        backupRetentionDays: 7,
                    },
                    mockLogger as any
                );
                await fileSystemService.initialize();

                // Create initial file
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'original content');

                // Write new content (should NOT create backup)
                const result = await fileSystemService.writeFile(testFile, 'new content');

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeUndefined();

                // Verify backup directory doesn't exist or is empty
                const backupDir = path.join(tempDir, '.dexto-backups');
                try {
                    const files = await fs.readdir(backupDir);
                    expect(files.length).toBe(0);
                } catch {
                    // Backup dir doesn't exist, which is expected
                }
            });

            it('should create backup when enableBackups is true', async () => {
                const fileSystemService = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: true,
                        backupRetentionDays: 7,
                    },
                    mockLogger as any
                );
                await fileSystemService.initialize();

                // Create initial file
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'original content');

                // Write new content (should create backup)
                const result = await fileSystemService.writeFile(testFile, 'new content');

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeDefined();
                expect(result.backupPath).toContain('.dexto');
                expect(result.backupPath).toContain('backup');

                // Verify backup file exists and contains original content
                const backupContent = await fs.readFile(result.backupPath!, 'utf-8');
                expect(backupContent).toBe('original content');

                // Verify new content was written
                const newContent = await fs.readFile(testFile, 'utf-8');
                expect(newContent).toBe('new content');
            });

            it('should NOT create backup for new files even when enableBackups is true', async () => {
                const fileSystemService = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: true,
                        backupRetentionDays: 7,
                    },
                    mockLogger as any
                );
                await fileSystemService.initialize();

                // Write to a new file (no backup needed since file doesn't exist)
                const testFile = path.join(tempDir, 'new-file.txt');
                const result = await fileSystemService.writeFile(testFile, 'content', {
                    createDirs: true,
                });

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeUndefined();
            });

            it('should respect per-call backup option over config', async () => {
                const fileSystemService = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: false, // Config says no backups
                        backupRetentionDays: 7,
                    },
                    mockLogger as any
                );
                await fileSystemService.initialize();

                // Create initial file
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'original content');

                // Write with explicit backup: true (should override config)
                const result = await fileSystemService.writeFile(testFile, 'new content', {
                    backup: true,
                });

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeDefined();
            });
        });

        describe('editFile', () => {
            it('should NOT create backup when enableBackups is false (default)', async () => {
                const fileSystemService = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: false,
                        backupRetentionDays: 7,
                    },
                    mockLogger as any
                );
                await fileSystemService.initialize();

                // Create initial file
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'hello world');

                // Edit file (should NOT create backup)
                const result = await fileSystemService.editFile(testFile, {
                    oldString: 'world',
                    newString: 'universe',
                });

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeUndefined();

                // Verify content was changed
                const content = await fs.readFile(testFile, 'utf-8');
                expect(content).toBe('hello universe');
            });

            it('should create backup when enableBackups is true', async () => {
                const fileSystemService = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: true,
                        backupRetentionDays: 7,
                    },
                    mockLogger as any
                );
                await fileSystemService.initialize();

                // Create initial file
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'hello world');

                // Edit file (should create backup)
                const result = await fileSystemService.editFile(testFile, {
                    oldString: 'world',
                    newString: 'universe',
                });

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeDefined();

                // Verify backup contains original content
                const backupContent = await fs.readFile(result.backupPath!, 'utf-8');
                expect(backupContent).toBe('hello world');

                // Verify new content
                const content = await fs.readFile(testFile, 'utf-8');
                expect(content).toBe('hello universe');
            });

            it('should respect per-call backup option over config', async () => {
                const fileSystemService = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: false, // Config says no backups
                        backupRetentionDays: 7,
                    },
                    mockLogger as any
                );
                await fileSystemService.initialize();

                // Create initial file
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'hello world');

                // Edit with explicit backup: true (should override config)
                const result = await fileSystemService.editFile(
                    testFile,
                    {
                        oldString: 'world',
                        newString: 'universe',
                    },
                    { backup: true }
                );

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeDefined();
            });
        });
    });
});
