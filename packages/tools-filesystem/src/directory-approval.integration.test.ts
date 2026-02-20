/**
 * Directory Approval Integration Tests
 *
 * Tests for the directory access permission system integrated into filesystem tools.
 *
 * Key behaviors tested:
 * - Paths within config-allowed roots do not require directory access prompting metadata
 * - Paths outside config-allowed roots return directory access prompting metadata
 * - Session-approved directories do not prompt again
 * - Once-approved directories still prompt again (prompting decision)
 * - Session approvals cover child paths but not sibling directories
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
    ApprovalManager,
    DextoRuntimeError,
    type Logger,
    type ToolExecutionContext,
} from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import { createReadFileTool } from './read-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';
import { createEditFileTool } from './edit-file-tool.js';

type ToolServices = NonNullable<ToolExecutionContext['services']>;

const createMockLogger = (): Logger => {
    const noopAsync = async () => undefined;

    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: () => logger,
        setLevel: vi.fn(),
        getLevel: () => 'info',
        getLogFilePath: () => null,
        destroy: noopAsync,
    };

    return logger;
};

function createToolContext(logger: Logger, approval: ApprovalManager): ToolExecutionContext {
    return {
        logger,
        services: {
            approval,
            search: {} as unknown as ToolServices['search'],
            resources: {} as unknown as ToolServices['resources'],
            prompts: {} as unknown as ToolServices['prompts'],
            mcp: {} as unknown as ToolServices['mcp'],
            taskForker: null,
        },
    };
}

describe('Directory Approval Integration Tests', () => {
    let mockLogger: Logger;
    let tempDir: string;
    let fileSystemService: FileSystemService;
    let approvalManager: ApprovalManager;
    let toolContext: ToolExecutionContext;
    const getFileSystemService = async (_context: ToolExecutionContext) => fileSystemService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        // Resolve real path to handle symlinks (macOS /tmp -> /private/var/folders/...)
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-fs-test-'));
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

        approvalManager = new ApprovalManager(
            {
                permissions: { mode: 'manual' },
                elicitation: { enabled: true },
            },
            mockLogger
        );

        toolContext = createToolContext(mockLogger, approvalManager);

        vi.clearAllMocks();
    });

    afterEach(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('getApprovalOverride', () => {
        it('should return null for paths within config-allowed roots', async () => {
            const tool = createReadFileTool(getFileSystemService);

            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'test content');

            const metadata = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: testFile }),
                toolContext
            );
            expect(metadata).toBeNull();
        });

        it('should return directory access metadata for external paths', async () => {
            const tool = createReadFileTool(getFileSystemService);

            const externalPath = '/external/project/file.ts';

            const metadata = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: externalPath }),
                toolContext
            );

            expect(metadata).not.toBeNull();
            expect(metadata).toMatchObject({
                type: 'directory_access',
                metadata: {
                    path: path.resolve(externalPath),
                    parentDir: path.dirname(path.resolve(externalPath)),
                    operation: 'read',
                    toolName: 'read_file',
                },
            });
        });

        it('should return null when external path is session-approved', async () => {
            approvalManager.addApprovedDirectory('/external/project', 'session');

            const tool = createReadFileTool(getFileSystemService);
            const externalPath = '/external/project/file.ts';

            const metadata = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: externalPath }),
                toolContext
            );
            expect(metadata).toBeNull();
        });

        it('should still return metadata when external path is once-approved (prompt again)', async () => {
            approvalManager.addApprovedDirectory('/external/project', 'once');

            const tool = createReadFileTool(getFileSystemService);
            const externalPath = '/external/project/file.ts';

            const metadata = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: externalPath }),
                toolContext
            );
            expect(metadata).not.toBeNull();
        });
    });

    describe('Different tool operations', () => {
        it('should label write operations correctly', async () => {
            const tool = createWriteFileTool(getFileSystemService);
            const externalPath = '/external/project/new.ts';

            const metadata = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: externalPath, content: 'test' }),
                toolContext
            );

            expect(metadata).not.toBeNull();
            expect(metadata).toMatchObject({
                type: 'directory_access',
                metadata: {
                    path: path.resolve(externalPath),
                    parentDir: path.dirname(path.resolve(externalPath)),
                    operation: 'write',
                    toolName: 'write_file',
                },
            });
        });

        it('should label edit operations correctly', async () => {
            const tool = createEditFileTool(getFileSystemService);
            const externalPath = '/external/project/existing.ts';

            const metadata = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({
                    file_path: externalPath,
                    old_string: 'old',
                    new_string: 'new',
                }),
                toolContext
            );

            expect(metadata).not.toBeNull();
            expect(metadata).toMatchObject({
                type: 'directory_access',
                metadata: {
                    path: path.resolve(externalPath),
                    parentDir: path.dirname(path.resolve(externalPath)),
                    operation: 'edit',
                    toolName: 'edit_file',
                },
            });
        });
    });

    describe('Path containment scenarios', () => {
        it('should cover child paths when parent directory is session-approved', async () => {
            const tool = createReadFileTool(getFileSystemService);
            approvalManager.addApprovedDirectory('/external/project', 'session');

            const metadata1 = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: '/external/project/file.ts' }),
                toolContext
            );
            expect(metadata1).toBeNull();

            const metadata2 = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: '/external/project/deep/nested/file.ts' }),
                toolContext
            );
            expect(metadata2).toBeNull();
        });

        it('should NOT cover sibling directories', async () => {
            const tool = createReadFileTool(getFileSystemService);
            approvalManager.addApprovedDirectory('/external/sub', 'session');

            const metadata1 = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: '/external/sub/file.ts' }),
                toolContext
            );
            expect(metadata1).toBeNull();

            const metadata2 = await tool.getApprovalOverride?.(
                tool.inputSchema.parse({ file_path: '/external/other/file.ts' }),
                toolContext
            );
            expect(metadata2).not.toBeNull();
        });
    });

    describe('Without ApprovalManager in context', () => {
        it('should throw for external paths', async () => {
            const tool = createReadFileTool(getFileSystemService);

            const contextWithoutApprovalManager: ToolExecutionContext = { logger: mockLogger };
            await expect(
                tool.getApprovalOverride?.(
                    tool.inputSchema.parse({ file_path: '/external/project/file.ts' }),
                    contextWithoutApprovalManager
                )
            ).rejects.toBeInstanceOf(DextoRuntimeError);
        });
    });
});
