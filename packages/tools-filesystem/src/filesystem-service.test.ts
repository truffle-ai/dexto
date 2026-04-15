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

        it('paginates text reads with startLine and nextOffset metadata', async () => {
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

            const testFile = path.join(tempDir, 'paged.txt');
            await fs.writeFile(testFile, 'one\ntwo\nthree\nfour');

            const result = await fileSystemService.readFile(testFile, {
                offset: 2,
                limit: 2,
            });

            expect(result.content).toBe('two\nthree\n');
            expect(result.lines).toBe(2);
            expect(result.truncated).toBe(true);
            expect(result.startLine).toBe(2);
            expect(result.nextOffset).toBe(4);
        });

        it('preserves CRLF and trailing newline for full-file reads', async () => {
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

            const testFile = path.join(tempDir, 'crlf.txt');
            await fs.writeFile(testFile, 'a\r\nb\r\n', 'utf-8');

            const result = await fileSystemService.readFile(testFile);

            expect(result.content).toBe('a\r\nb\r\n');
            expect(result.lines).toBe(2);
            expect(result.truncated).toBe(false);
        });

        it('preserves exact separators for paginated CRLF reads', async () => {
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

            const testFile = path.join(tempDir, 'crlf-paged.txt');
            await fs.writeFile(testFile, 'a\r\nb\r\nc\r\n', 'utf-8');

            const result = await fileSystemService.readFile(testFile, {
                offset: 2,
                limit: 1,
            });

            expect(result.content).toBe('b\r\n');
            expect(result.lines).toBe(1);
            expect(result.truncated).toBe(true);
            expect(result.startLine).toBe(2);
            expect(result.nextOffset).toBe(3);
        });
    });

    describe('Path Discovery', () => {
        it('finds likely file and directory matches from path fragments', async () => {
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

            const featureDir = path.join(tempDir, 'src', 'feature-area');
            const targetFile = path.join(featureDir, 'target-service.ts');
            await fs.mkdir(featureDir, { recursive: true });
            await fs.writeFile(targetFile, 'export const value = 1;\n');

            const fileResult = await fileSystemService.findPaths('target service');
            expect(
                fileResult.matches.some(
                    (match) => match.path === targetFile && match.pathType === 'file'
                )
            ).toBe(true);

            const directoryResult = await fileSystemService.findPaths('feature-area', {
                pathType: 'directory',
            });
            expect(
                directoryResult.matches.some(
                    (match) => match.path === featureDir && match.pathType === 'directory'
                )
            ).toBe(true);
        });

        it('returns empty directories when searching for directory paths', async () => {
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

            const emptyDir = path.join(tempDir, 'src', 'empty-feature');
            await fs.mkdir(emptyDir, { recursive: true });

            const result = await fileSystemService.findPaths('empty feature', {
                pathType: 'directory',
            });

            expect(
                result.matches.some(
                    (match) => match.path === emptyDir && match.pathType === 'directory'
                )
            ).toBe(true);
        });
    });

    describe('Search Semantics', () => {
        it('treats patterns as literal text by default and supports regex mode', async () => {
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

            const testFile = path.join(tempDir, 'search.txt');
            await fs.writeFile(testFile, 'foo.bar\nfooXbar\n');

            const literalResult = await fileSystemService.searchContent('foo.bar');
            expect(literalResult.matches).toHaveLength(1);
            expect(literalResult.matches[0]?.line).toBe('foo.bar');

            const regexResult = await fileSystemService.searchContent('foo.bar', {
                literal: false,
            });
            expect(regexResult.matches).toHaveLength(2);
        });

        it('rejects unsafe regex patterns before invoking search backends', async () => {
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

            const testFile = path.join(tempDir, 'unsafe-search.txt');
            await fs.writeFile(testFile, 'aaaaaaaaaaaaaaaaaaaa\n');

            await expect(
                fileSystemService.searchContent('(a+)+$', {
                    literal: false,
                })
            ).rejects.toThrow(/catastrophic backtracking|Invalid pattern/i);
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

            it('preserves original line endings and final newline when editing', async () => {
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

                const testFile = path.join(tempDir, 'crlf-edit.txt');
                await fs.writeFile(testFile, 'a\r\nb\r\n', 'utf-8');

                await fileSystemService.editFile(testFile, {
                    oldString: 'a',
                    newString: 'A',
                });

                const updatedContent = await fs.readFile(testFile, 'utf-8');
                expect(updatedContent).toBe('A\r\nb\r\n');
            });
        });
    });
});
