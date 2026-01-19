/**
 * Write File Tool Tests
 *
 * Tests for the write_file tool including file modification detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createWriteFileTool } from './write-file-tool.js';
import { FileSystemService } from './filesystem-service.js';
import { ToolErrorCode } from '@dexto/core';
import { DextoRuntimeError } from '@dexto/core';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('write_file tool', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let fileSystemService: FileSystemService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-write-test-'));
        tempDir = await fs.realpath(rawTempDir);

        fileSystemService = new FileSystemService(
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

    describe('File Modification Detection - Existing Files', () => {
        it('should succeed when existing file is not modified between preview and execute', async () => {
            const tool = createWriteFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original content');

            const toolCallId = 'test-call-123';
            const input = {
                file_path: testFile,
                content: 'new content',
            };

            // Generate preview (stores hash)
            const preview = await tool.generatePreview!(input, { toolCallId });
            expect(preview).toBeDefined();
            expect(preview?.type).toBe('diff');

            // Execute without modifying file (should succeed)
            const result = (await tool.execute(input, { toolCallId })) as {
                success: boolean;
                path: string;
            };

            expect(result.success).toBe(true);
            expect(result.path).toBe(testFile);

            // Verify file was written
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('new content');
        });

        it('should fail when existing file is modified between preview and execute', async () => {
            const tool = createWriteFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original content');

            const toolCallId = 'test-call-456';
            const input = {
                file_path: testFile,
                content: 'new content',
            };

            // Generate preview (stores hash)
            await tool.generatePreview!(input, { toolCallId });

            // Simulate user modifying the file externally
            await fs.writeFile(testFile, 'user modified this');

            // Execute should fail because file was modified
            try {
                await tool.execute(input, { toolCallId });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    ToolErrorCode.FILE_MODIFIED_SINCE_PREVIEW
                );
            }

            // Verify file was NOT modified by the tool (still has user's changes)
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('user modified this');
        });

        it('should fail when existing file is deleted between preview and execute', async () => {
            const tool = createWriteFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original content');

            const toolCallId = 'test-call-deleted';
            const input = {
                file_path: testFile,
                content: 'new content',
            };

            // Generate preview (stores hash of existing file)
            await tool.generatePreview!(input, { toolCallId });

            // Simulate user deleting the file
            await fs.unlink(testFile);

            // Execute should fail because file was deleted
            try {
                await tool.execute(input, { toolCallId });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    ToolErrorCode.FILE_MODIFIED_SINCE_PREVIEW
                );
            }
        });
    });

    describe('File Modification Detection - New Files', () => {
        it('should succeed when creating new file that still does not exist', async () => {
            const tool = createWriteFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'new-file.txt');

            const toolCallId = 'test-call-new';
            const input = {
                file_path: testFile,
                content: 'brand new content',
            };

            // Generate preview (stores marker that file doesn't exist)
            const preview = await tool.generatePreview!(input, { toolCallId });
            expect(preview).toBeDefined();
            expect(preview?.type).toBe('file');
            expect((preview as any).operation).toBe('create');

            // Execute (file still doesn't exist - should succeed)
            const result = (await tool.execute(input, { toolCallId })) as { success: boolean };

            expect(result.success).toBe(true);

            // Verify file was created
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('brand new content');
        });

        it('should fail when file is created by someone else between preview and execute', async () => {
            const tool = createWriteFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'race-condition.txt');

            const toolCallId = 'test-call-race';
            const input = {
                file_path: testFile,
                content: 'agent content',
            };

            // Generate preview (file doesn't exist)
            const preview = await tool.generatePreview!(input, { toolCallId });
            expect(preview?.type).toBe('file');

            // Simulate someone else creating the file
            await fs.writeFile(testFile, 'someone else created this');

            // Execute should fail because file now exists
            try {
                await tool.execute(input, { toolCallId });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    ToolErrorCode.FILE_MODIFIED_SINCE_PREVIEW
                );
            }

            // Verify the other person's file is preserved
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('someone else created this');
        });
    });

    describe('Cache Cleanup', () => {
        it('should clean up hash cache after successful execution', async () => {
            const tool = createWriteFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original');

            const toolCallId = 'test-call-cleanup';
            const input = {
                file_path: testFile,
                content: 'first write',
            };

            // First write
            await tool.generatePreview!(input, { toolCallId });
            await tool.execute(input, { toolCallId });

            // Second write with same toolCallId should work
            const input2 = {
                file_path: testFile,
                content: 'second write',
            };
            await tool.generatePreview!(input2, { toolCallId });
            const result = (await tool.execute(input2, { toolCallId })) as { success: boolean };

            expect(result.success).toBe(true);
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('second write');
        });

        it('should clean up hash cache after failed execution', async () => {
            const tool = createWriteFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original');

            const toolCallId = 'test-call-fail';
            const input = {
                file_path: testFile,
                content: 'new content',
            };

            // Preview
            await tool.generatePreview!(input, { toolCallId });

            // Modify to cause failure
            await fs.writeFile(testFile, 'modified');

            // Execute fails
            try {
                await tool.execute(input, { toolCallId });
            } catch {
                // Expected
            }

            // Reset file
            await fs.writeFile(testFile, 'reset content');

            // Next execution with same toolCallId should work
            await tool.generatePreview!(input, { toolCallId });
            const result = (await tool.execute(input, { toolCallId })) as { success: boolean };

            expect(result.success).toBe(true);
        });
    });
});
