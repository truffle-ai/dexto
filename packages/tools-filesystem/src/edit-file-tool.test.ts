/**
 * Edit File Tool Tests
 *
 * Tests for the edit_file tool including file modification detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createEditFileTool } from './edit-file-tool.js';
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

describe('edit_file tool', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let fileSystemService: FileSystemService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-edit-test-'));
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

    describe('File Modification Detection', () => {
        it('should succeed when file is not modified between preview and execute', async () => {
            const tool = createEditFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'hello world');

            const toolCallId = 'test-call-123';
            const input = {
                file_path: testFile,
                old_string: 'world',
                new_string: 'universe',
            };

            // Generate preview (stores hash)
            const preview = await tool.generatePreview!(input, { toolCallId });
            expect(preview).toBeDefined();

            // Execute without modifying file (should succeed)
            const result = await tool.execute(input, { toolCallId });

            expect(result.success).toBe(true);
            expect(result.path).toBe(testFile);

            // Verify file was edited
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('hello universe');
        });

        it('should fail when file is modified between preview and execute', async () => {
            const tool = createEditFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'hello world');

            const toolCallId = 'test-call-456';
            const input = {
                file_path: testFile,
                old_string: 'world',
                new_string: 'universe',
            };

            // Generate preview (stores hash)
            const preview = await tool.generatePreview!(input, { toolCallId });
            expect(preview).toBeDefined();

            // Simulate user modifying the file externally (keep 'world' so edit would work without hash check)
            await fs.writeFile(testFile, 'hello world - user added this');

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
            expect(content).toBe('hello world - user added this');
        });

        it('should detect file modification with correct error code', async () => {
            const tool = createEditFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'hello world');

            const toolCallId = 'test-call-789';
            const input = {
                file_path: testFile,
                old_string: 'world',
                new_string: 'universe',
            };

            // Generate preview (stores hash)
            await tool.generatePreview!(input, { toolCallId });

            // Simulate user modifying the file externally
            await fs.writeFile(testFile, 'hello world modified');

            // Execute should fail with FILE_MODIFIED_SINCE_PREVIEW error
            try {
                await tool.execute(input, { toolCallId });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    ToolErrorCode.FILE_MODIFIED_SINCE_PREVIEW
                );
                expect((error as DextoRuntimeError).message).toContain(
                    'modified since the preview'
                );
                expect((error as DextoRuntimeError).message).toContain('read the file again');
            }
        });

        it('should work without toolCallId (no modification check)', async () => {
            const tool = createEditFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'hello world');

            const input = {
                file_path: testFile,
                old_string: 'world',
                new_string: 'universe',
            };

            // Generate preview without toolCallId
            await tool.generatePreview!(input, {});

            // Modify file
            await fs.writeFile(testFile, 'hello world changed');

            // Execute without toolCallId - should NOT check for modifications
            // (but will fail because old_string won't match the new content)
            // This tests that the tool doesn't crash when toolCallId is missing
            try {
                await tool.execute(input, {});
            } catch (error) {
                // Expected to fail because 'world' is no longer in the file
                // But it should NOT be FILE_MODIFIED_SINCE_PREVIEW error
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).not.toBe(
                    ToolErrorCode.FILE_MODIFIED_SINCE_PREVIEW
                );
            }
        });

        it('should clean up hash cache after successful execution', async () => {
            const tool = createEditFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'hello world');

            const toolCallId = 'test-call-cleanup';
            const input = {
                file_path: testFile,
                old_string: 'world',
                new_string: 'universe',
            };

            // Generate preview
            await tool.generatePreview!(input, { toolCallId });

            // Execute successfully
            await tool.execute(input, { toolCallId });

            // Prepare for second edit
            const input2 = {
                file_path: testFile,
                old_string: 'universe',
                new_string: 'galaxy',
            };

            // Second execution with same toolCallId should work
            // (hash should have been cleaned up, so no stale check)
            await tool.generatePreview!(input2, { toolCallId });
            const result = await tool.execute(input2, { toolCallId });

            expect(result.success).toBe(true);
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('hello galaxy');
        });

        it('should clean up hash cache after failed execution', async () => {
            const tool = createEditFileTool({ fileSystemService });
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'hello world');

            const toolCallId = 'test-call-fail-cleanup';
            const input = {
                file_path: testFile,
                old_string: 'world',
                new_string: 'universe',
            };

            // Generate preview
            await tool.generatePreview!(input, { toolCallId });

            // Modify file to cause failure
            await fs.writeFile(testFile, 'hello world modified');

            // Execute should fail
            try {
                await tool.execute(input, { toolCallId });
            } catch {
                // Expected
            }

            // Reset file
            await fs.writeFile(testFile, 'hello world');

            // Next execution with same toolCallId should work
            // (hash should have been cleaned up even after failure)
            await tool.generatePreview!(input, { toolCallId });
            const result = await tool.execute(input, { toolCallId });

            expect(result.success).toBe(true);
        });
    });
});
