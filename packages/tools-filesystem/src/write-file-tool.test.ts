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
import type { Logger, ToolExecutionContext } from '@dexto/core';

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

function createToolContext(
    logger: Logger,
    overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
    return { logger, ...overrides };
}

describe('write_file tool', () => {
    let mockLogger: Logger;
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
            mockLogger
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
        it('should generate preview for existing files outside config-allowed roots (preview read only)', async () => {
            const tool = createWriteFileTool(async () => fileSystemService);

            const rawExternalDir = await fs.mkdtemp(
                path.join(os.tmpdir(), 'dexto-write-outside-allowed-')
            );
            const externalDir = await fs.realpath(rawExternalDir);
            const externalFile = path.join(externalDir, 'external.txt');

            try {
                await fs.writeFile(externalFile, 'original content');

                const toolCallId = 'preview-outside-roots';
                const parsedInput = tool.inputSchema.parse({
                    file_path: externalFile,
                    content: 'new content',
                });

                const preview = await tool.presentation!.preview!(
                    parsedInput,
                    createToolContext(mockLogger, { toolCallId })
                );

                expect(preview).toBeDefined();
                expect(preview?.type).toBe('diff');
                if (preview?.type === 'diff') {
                    expect(preview.title).toBe('Update file');
                    expect(preview.filename).toBe(externalFile);
                } else {
                    expect.fail('Expected diff preview');
                }
            } finally {
                await fs.rm(externalDir, { recursive: true, force: true });
            }
        });

        it('should succeed when existing file is not modified between preview and execute', async () => {
            const tool = createWriteFileTool(async () => fileSystemService);
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original content');

            const toolCallId = 'test-call-123';
            const input = {
                file_path: testFile,
                content: 'new content',
            };
            const parsedInput = tool.inputSchema.parse(input);

            // Generate preview (stores hash)
            const preview = await tool.presentation!.preview!(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            );
            expect(preview).toBeDefined();
            expect(preview?.type).toBe('diff');
            if (preview?.type === 'diff') {
                expect(preview.title).toBe('Update file');
            } else {
                expect.fail('Expected diff preview');
            }

            // Execute without modifying file (should succeed)
            const result = (await tool.execute(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            )) as {
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
            const tool = createWriteFileTool(async () => fileSystemService);
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original content');

            const toolCallId = 'test-call-456';
            const input = {
                file_path: testFile,
                content: 'new content',
            };
            const parsedInput = tool.inputSchema.parse(input);

            // Generate preview (stores hash)
            await tool.presentation!.preview!(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            );

            // Simulate user modifying the file externally
            await fs.writeFile(testFile, 'user modified this');

            // Execute should fail because file was modified
            try {
                await tool.execute(parsedInput, createToolContext(mockLogger, { toolCallId }));
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
            const tool = createWriteFileTool(async () => fileSystemService);
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original content');

            const toolCallId = 'test-call-deleted';
            const input = {
                file_path: testFile,
                content: 'new content',
            };
            const parsedInput = tool.inputSchema.parse(input);

            // Generate preview (stores hash of existing file)
            await tool.presentation!.preview!(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            );

            // Simulate user deleting the file
            await fs.unlink(testFile);

            // Execute should fail because file was deleted
            try {
                await tool.execute(parsedInput, createToolContext(mockLogger, { toolCallId }));
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
            const tool = createWriteFileTool(async () => fileSystemService);
            const testFile = path.join(tempDir, 'new-file.txt');

            const toolCallId = 'test-call-new';
            const input = {
                file_path: testFile,
                content: 'brand new content',
            };
            const parsedInput = tool.inputSchema.parse(input);

            // Generate preview (stores marker that file doesn't exist)
            const preview = await tool.presentation!.preview!(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            );
            expect(preview).toBeDefined();
            expect(preview?.type).toBe('file');
            if (preview?.type === 'file') {
                expect(preview.operation).toBe('create');
                expect(preview.title).toBe('Create file');
            } else {
                expect.fail('Expected file preview');
            }

            // Execute (file still doesn't exist - should succeed)
            const result = (await tool.execute(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            )) as { success: boolean; _display?: unknown };

            expect(result.success).toBe(true);
            const display = result._display;
            if (display && typeof display === 'object' && 'type' in display) {
                expect((display as { type?: unknown }).type).toBe('file');
                const fileDisplay = display as { title?: unknown; content?: unknown };
                expect(fileDisplay.title).toBe('Create file');
                expect(fileDisplay.content).toBe('brand new content');
            } else {
                expect.fail('Expected result._display');
            }

            // Verify file was created
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('brand new content');
        });

        it('should fail when file is created by someone else between preview and execute', async () => {
            const tool = createWriteFileTool(async () => fileSystemService);
            const previewFn = tool.presentation?.preview;
            expect(previewFn).toBeDefined();
            const testFile = path.join(tempDir, 'race-condition.txt');

            const toolCallId = 'test-call-race';
            const input = {
                file_path: testFile,
                content: 'agent content',
            };
            const parsedInput = tool.inputSchema.parse(input);

            // Generate preview (file doesn't exist)
            const preview = await previewFn!(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            );
            expect(preview?.type).toBe('file');

            // Simulate someone else creating the file
            await fs.writeFile(testFile, 'someone else created this');

            // Execute should fail because file now exists
            try {
                await tool.execute(parsedInput, createToolContext(mockLogger, { toolCallId }));
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
            const tool = createWriteFileTool(async () => fileSystemService);
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original');

            const toolCallId = 'test-call-cleanup';
            const input = {
                file_path: testFile,
                content: 'first write',
            };
            const parsedInput = tool.inputSchema.parse(input);

            // First write
            await tool.presentation!.preview!(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            );
            await tool.execute(parsedInput, createToolContext(mockLogger, { toolCallId }));

            // Second write with same toolCallId should work
            const input2 = {
                file_path: testFile,
                content: 'second write',
            };
            const parsedInput2 = tool.inputSchema.parse(input2);
            const previewFn2 = tool.presentation?.preview;
            expect(previewFn2).toBeDefined();
            await previewFn2!(parsedInput2, createToolContext(mockLogger, { toolCallId }));
            const result = (await tool.execute(
                parsedInput2,
                createToolContext(mockLogger, { toolCallId })
            )) as { success: boolean };

            expect(result.success).toBe(true);
            const content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('second write');
        });

        it('should clean up hash cache after failed execution', async () => {
            const tool = createWriteFileTool(async () => fileSystemService);
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'original');

            const toolCallId = 'test-call-fail';
            const input = {
                file_path: testFile,
                content: 'new content',
            };
            const parsedInput = tool.inputSchema.parse(input);

            // Preview
            const previewFn = tool.presentation?.preview;
            expect(previewFn).toBeDefined();
            await previewFn!(parsedInput, createToolContext(mockLogger, { toolCallId }));

            // Modify to cause failure
            await fs.writeFile(testFile, 'modified');

            // Execute fails
            try {
                await tool.execute(parsedInput, createToolContext(mockLogger, { toolCallId }));
            } catch {
                // Expected
            }

            // Reset file
            await fs.writeFile(testFile, 'reset content');

            // Next execution with same toolCallId should work
            await previewFn!(parsedInput, createToolContext(mockLogger, { toolCallId }));
            const result = (await tool.execute(
                parsedInput,
                createToolContext(mockLogger, { toolCallId })
            )) as { success: boolean };

            expect(result.success).toBe(true);
        });
    });
});
