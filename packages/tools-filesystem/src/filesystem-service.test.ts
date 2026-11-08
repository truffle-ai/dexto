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
import type { Logger } from '@dexto/core';

// Windows has no O_NOFOLLOW; let a test hide it from the service to exercise that path.
const nodeFs = vi.hoisted(() => ({ hideNoFollow: false }));
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    const constants = { ...actual.constants };
    Object.defineProperty(constants, 'O_NOFOLLOW', {
        enumerable: true,
        get: () => (nodeFs.hideNoFollow ? undefined : actual.constants.O_NOFOLLOW),
    });
    return { ...actual, constants };
});

// Create mock logger
const createMockLogger = (): Logger => {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        createFileOnlyChild: vi.fn(() => logger),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'debug' as const),
        getLogFilePath: vi.fn(() => null),
        destroy: vi.fn(async () => undefined),
    };
    return logger;
};

describe('FileSystemService', () => {
    let mockLogger: Logger;
    let tempDir: string;
    let backupDir: string;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-fs-test-'));
        tempDir = await fs.realpath(rawTempDir);
        backupDir = path.join(tempDir, '.dexto', 'backups');

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

    describe('Read Modes', () => {
        it('returns MIME metadata for text reads', async () => {
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
                mockLogger
            );
            await fileSystemService.initialize();

            const testFile = path.join(tempDir, 'notes.md');
            await fs.writeFile(testFile, '# hello\nworld');

            const result = await fileSystemService.readFile(testFile);

            expect(result.content).toBe('# hello\nworld');
            expect(result.mimeType).toBe('text/markdown');
        });

        it('rejects binary files from readFile and points callers to readMediaFile', async () => {
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
                mockLogger
            );
            await fileSystemService.initialize();

            const testFile = path.join(tempDir, 'image.png');
            await fs.writeFile(testFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

            await expect(fileSystemService.readFile(testFile)).rejects.toThrow(
                /Use read_media_file instead/
            );
        });

        it('rejects binary-like content even when the extension looks textual', async () => {
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
                mockLogger
            );
            await fileSystemService.initialize();

            const testFile = path.join(tempDir, 'data.json');
            await fs.writeFile(testFile, Buffer.from([0x7b, 0x00, 0x22, 0x78, 0x22, 0x7d]));

            await expect(fileSystemService.readFile(testFile)).rejects.toThrow(
                /Use read_media_file instead/
            );
        });

        it('reads media files as base64 with MIME-aware kind metadata', async () => {
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
                mockLogger
            );
            await fileSystemService.initialize();

            const testFile = path.join(tempDir, 'clip.mp4');
            const buffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
            await fs.writeFile(testFile, buffer);

            const result = await fileSystemService.readMediaFile(testFile);

            expect(result.data).toBe(buffer.toString('base64'));
            expect(result.mimeType).toBe('video/mp4');
            expect(result.kind).toBe('video');
            expect(result.filename).toBe('clip.mp4');
            expect(result.size).toBe(buffer.length);
        });

        it('rejects text files from readMediaFile and points callers to readFile', async () => {
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
                mockLogger
            );
            await fileSystemService.initialize();

            const testFile = path.join(tempDir, 'plain.txt');
            await fs.writeFile(testFile, 'hello world');

            await expect(fileSystemService.readMediaFile(testFile)).rejects.toThrow(
                /Use read_file instead/
            );
        });
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
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
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
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
                );
                await fileSystemService.initialize();

                // Create initial file
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'original content');

                // Write new content (should create backup)
                const result = await fileSystemService.writeFile(testFile, 'new content');

                expect(result.success).toBe(true);
                expect(result.backupPath).toBeDefined();
                expect(result.backupPath).toContain(backupDir);
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
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
                );
                await fileSystemService.initialize();

                // Write to a new file (no backup needed since file doesn't exist)
                const testFile = path.join(tempDir, 'new-file.txt');
                const result = await fileSystemService.writeFile(testFile, 'content');

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
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
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
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
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
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
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
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
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

        describe('symlinks are never followed', () => {
            let outsideDir: string;
            let service: FileSystemService;

            beforeEach(async () => {
                outsideDir = await fs.realpath(
                    await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-fs-outside-'))
                );
                service = new FileSystemService(
                    {
                        allowedPaths: [tempDir],
                        blockedPaths: [],
                        blockedExtensions: [],
                        maxFileSize: 10 * 1024 * 1024,
                        workingDirectory: tempDir,
                        enableBackups: true,
                        backupPath: backupDir,
                        backupRetentionDays: 7,
                    },
                    mockLogger
                );
                await service.initialize();
            });

            afterEach(async () => {
                vi.useRealTimers();
                nodeFs.hideNoFollow = false;
                await fs.rm(outsideDir, { recursive: true, force: true });
            });

            it('refuses to back up a symlink and copies nothing from its target', async () => {
                const secret = path.join(outsideDir, 'secret.txt');
                await fs.writeFile(secret, 'outside secret');
                const link = path.join(tempDir, 'link.txt');
                await fs.symlink(secret, link);

                await expect(service['createBackup'](link)).rejects.toThrow(/backup/i);

                expect(await fs.readdir(backupDir)).toEqual([]);
            });

            it('refuses a symlink source where O_NOFOLLOW is unavailable (Windows)', async () => {
                nodeFs.hideNoFollow = true;
                const secret = path.join(outsideDir, 'secret.txt');
                await fs.writeFile(secret, 'outside secret');
                const link = path.join(tempDir, 'link.txt');
                await fs.symlink(secret, link);

                await expect(service['createBackup'](link)).rejects.toThrow(/backup/i);

                expect(await fs.readdir(backupDir)).toEqual([]);
            });

            it('still backs up a regular file where O_NOFOLLOW is unavailable (Windows)', async () => {
                nodeFs.hideNoFollow = true;
                const source = path.join(tempDir, 'test.txt');
                await fs.writeFile(source, 'original content');

                const backupPath = await service['createBackup'](source);

                expect(await fs.readFile(backupPath, 'utf-8')).toBe('original content');
            });

            it('does not write through a symlink planted at the backup path', async () => {
                const victim = path.join(outsideDir, 'victim.txt');
                await fs.writeFile(victim, 'victim content');
                const source = path.join(tempDir, 'test.txt');
                await fs.writeFile(source, 'original content');

                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                await fs.symlink(victim, path.join(backupDir, `test.txt.${timestamp}.backup`));

                await expect(service['createBackup'](source)).rejects.toThrow(/backup/i);

                expect(await fs.readFile(victim, 'utf-8')).toBe('victim content');
            });
        });
    });
});
