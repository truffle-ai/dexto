/**
 * Directory Approval Integration Tests
 *
 * Tests for the directory access permission system integrated into file tools.
 *
 * Key behaviors tested:
 * 1. Working directory: No directory prompt, normal tool flow
 * 2. External dir (first access): Directory prompt via getApprovalOverride
 * 3. External dir (after "session" approval): No directory prompt
 * 4. External dir (after "once" approval): Directory prompt every time
 * 5. Path containment: approving /ext covers /ext/sub/file.txt
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createReadFileTool } from './read-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';
import { createEditFileTool } from './edit-file-tool.js';
import { FileSystemService } from './filesystem-service.js';
import {
    ApprovalManager,
    ApprovalStatus,
    ApprovalType,
    type IDextoLogger,
    type ToolExecutionContext,
} from '@dexto/core';

type ToolServices = NonNullable<ToolExecutionContext['services']>;

const createMockLogger = (): IDextoLogger => {
    const noopAsync = async () => undefined;

    const logger: IDextoLogger = {
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

function createToolContext(approval: ApprovalManager): ToolExecutionContext {
    return {
        services: {
            approval,
            search: {} as unknown as ToolServices['search'],
            resources: {} as unknown as ToolServices['resources'],
            prompts: {} as unknown as ToolServices['prompts'],
            mcp: {} as unknown as ToolServices['mcp'],
        },
    };
}

describe('Directory Approval Integration Tests', () => {
    let mockLogger: IDextoLogger;
    let tempDir: string;
    let fileSystemService: FileSystemService;
    let approvalManager: ApprovalManager;
    let toolContext: ToolExecutionContext;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Create temp directory for testing
        // Resolve real path to handle symlinks (macOS /tmp -> /private/var/folders/...)
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-fs-test-'));
        tempDir = await fs.realpath(rawTempDir);

        // Create FileSystemService with temp dir as working directory
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
                toolConfirmation: { mode: 'manual' },
                elicitation: { enabled: true },
            },
            mockLogger
        );

        toolContext = createToolContext(approvalManager);

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

    // =====================================================================
    // READ FILE TOOL TESTS
    // =====================================================================

    describe('Read File Tool', () => {
        describe('getApprovalOverride', () => {
            it('should return null for paths within working directory (no prompt needed)', async () => {
                const tool = createReadFileTool(fileSystemService);

                // Create test file in working directory
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'test content');

                const override = await tool.getApprovalOverride?.(
                    { file_path: testFile },
                    toolContext
                );
                expect(override).toBeNull();
            });

            it('should return directory access approval for external paths', async () => {
                const tool = createReadFileTool(fileSystemService);

                // External path (outside working directory)
                const externalPath = '/external/project/file.ts';

                const override = await tool.getApprovalOverride?.(
                    { file_path: externalPath },
                    toolContext
                );

                expect(override).not.toBeNull();
                expect(override?.type).toBe(ApprovalType.DIRECTORY_ACCESS);
                const metadata = override?.metadata as any;
                expect(metadata?.path).toBe(path.resolve(externalPath));
                expect(metadata?.parentDir).toBe(path.dirname(path.resolve(externalPath)));
                expect(metadata?.operation).toBe('read');
                expect(metadata?.toolName).toBe('read_file');
            });

            it('should return null when external path is session-approved', async () => {
                approvalManager.addApprovedDirectory('/external/project', 'session');

                const tool = createReadFileTool(fileSystemService);
                const externalPath = '/external/project/file.ts';

                const override = await tool.getApprovalOverride?.(
                    { file_path: externalPath },
                    toolContext
                );
                expect(override).toBeNull();
            });

            it('should return null when file_path is missing', async () => {
                const tool = createReadFileTool(fileSystemService);
                const override = await tool.getApprovalOverride?.({}, toolContext);
                expect(override).toBeNull();
            });
        });

        describe('onApprovalGranted', () => {
            it('should add directory as session-approved when rememberDirectory is true', async () => {
                const tool = createReadFileTool(fileSystemService);

                // First trigger getApprovalOverride to set pendingApprovalParentDir
                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath }, toolContext);

                tool.onApprovalGranted?.(
                    {
                        approvalId: 'test-approval',
                        status: ApprovalStatus.APPROVED,
                        data: { rememberDirectory: true },
                    },
                    toolContext
                );

                expect(
                    approvalManager
                        .getApprovedDirectories()
                        .get(path.dirname(path.resolve(externalPath)))
                ).toBe('session');
            });

            it('should add directory as once-approved when rememberDirectory is false', async () => {
                const tool = createReadFileTool(fileSystemService);

                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath }, toolContext);

                tool.onApprovalGranted?.(
                    {
                        approvalId: 'test-approval',
                        status: ApprovalStatus.APPROVED,
                        data: { rememberDirectory: false },
                    },
                    toolContext
                );

                expect(
                    approvalManager
                        .getApprovedDirectories()
                        .get(path.dirname(path.resolve(externalPath)))
                ).toBe('once');
            });

            it('should default to once-approved when rememberDirectory is not specified', async () => {
                const tool = createReadFileTool(fileSystemService);

                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath }, toolContext);

                tool.onApprovalGranted?.(
                    {
                        approvalId: 'test-approval',
                        status: ApprovalStatus.APPROVED,
                        data: {},
                    },
                    toolContext
                );

                expect(
                    approvalManager
                        .getApprovedDirectories()
                        .get(path.dirname(path.resolve(externalPath)))
                ).toBe('once');
            });

            it('should not throw if called without a tool context', async () => {
                const tool = createReadFileTool(fileSystemService);

                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath }, toolContext);

                tool.onApprovalGranted?.({
                    approvalId: 'test-approval',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                expect(approvalManager.getApprovedDirectoryPaths()).toEqual([]);
            });
        });

        describe('execute', () => {
            it('should read file contents within working directory', async () => {
                const tool = createReadFileTool(fileSystemService);

                const testFile = path.join(tempDir, 'readable.txt');
                await fs.writeFile(testFile, 'Hello, world!\nLine 2');

                const result = (await tool.execute({ file_path: testFile }, {})) as any;

                expect(result.content).toBe('Hello, world!\nLine 2');
                expect(result.lines).toBe(2);
            });
        });
    });

    // =====================================================================
    // WRITE FILE TOOL TESTS
    // =====================================================================

    describe('Write File Tool', () => {
        describe('getApprovalOverride', () => {
            it('should return null for paths within working directory', async () => {
                const tool = createWriteFileTool(fileSystemService);

                const testFile = path.join(tempDir, 'new-file.txt');

                const override = await tool.getApprovalOverride?.(
                    { file_path: testFile, content: 'test' },
                    toolContext
                );
                expect(override).toBeNull();
            });

            it('should return directory access approval for external paths', async () => {
                const tool = createWriteFileTool(fileSystemService);
                const externalPath = '/external/project/new.ts';

                const override = await tool.getApprovalOverride?.(
                    { file_path: externalPath, content: 'test' },
                    toolContext
                );

                expect(override).not.toBeNull();
                expect(override?.type).toBe(ApprovalType.DIRECTORY_ACCESS);
                const metadata = override?.metadata as any;
                expect(metadata?.operation).toBe('write');
                expect(metadata?.toolName).toBe('write_file');
            });

            it('should return null when external path is session-approved', async () => {
                approvalManager.addApprovedDirectory('/external/project', 'session');
                const tool = createWriteFileTool(fileSystemService);

                const externalPath = '/external/project/new.ts';

                const override = await tool.getApprovalOverride?.(
                    { file_path: externalPath, content: 'test' },
                    toolContext
                );
                expect(override).toBeNull();
            });
        });

        describe('onApprovalGranted', () => {
            it('should add directory as session-approved when rememberDirectory is true', async () => {
                const tool = createWriteFileTool(fileSystemService);

                const externalPath = '/external/project/new.ts';
                await tool.getApprovalOverride?.(
                    { file_path: externalPath, content: 'test' },
                    toolContext
                );

                tool.onApprovalGranted?.(
                    {
                        approvalId: 'test-approval',
                        status: ApprovalStatus.APPROVED,
                        data: { rememberDirectory: true },
                    },
                    toolContext
                );

                expect(
                    approvalManager
                        .getApprovedDirectories()
                        .get(path.dirname(path.resolve(externalPath)))
                ).toBe('session');
            });
        });
    });

    // =====================================================================
    // EDIT FILE TOOL TESTS
    // =====================================================================

    describe('Edit File Tool', () => {
        describe('getApprovalOverride', () => {
            it('should return null for paths within working directory', async () => {
                const tool = createEditFileTool(fileSystemService);

                const testFile = path.join(tempDir, 'existing.txt');

                const override = await tool.getApprovalOverride?.(
                    { file_path: testFile, old_string: 'old', new_string: 'new' },
                    toolContext
                );
                expect(override).toBeNull();
            });

            it('should return directory access approval for external paths', async () => {
                const tool = createEditFileTool(fileSystemService);

                const externalPath = '/external/project/existing.ts';

                const override = await tool.getApprovalOverride?.(
                    { file_path: externalPath, old_string: 'old', new_string: 'new' },
                    toolContext
                );

                expect(override).not.toBeNull();
                expect(override?.type).toBe(ApprovalType.DIRECTORY_ACCESS);
                const metadata = override?.metadata as any;
                expect(metadata?.operation).toBe('edit');
                expect(metadata?.toolName).toBe('edit_file');
            });

            it('should return null when external path is session-approved', async () => {
                approvalManager.addApprovedDirectory('/external/project', 'session');
                const tool = createEditFileTool(fileSystemService);

                const externalPath = '/external/project/existing.ts';

                const override = await tool.getApprovalOverride?.(
                    { file_path: externalPath, old_string: 'old', new_string: 'new' },
                    toolContext
                );
                expect(override).toBeNull();
            });
        });
    });

    // =====================================================================
    // SESSION VS ONCE APPROVAL SCENARIOS
    // =====================================================================

    describe('Session vs Once Approval Scenarios', () => {
        it('should not prompt for subsequent requests after session approval', async () => {
            const tool = createReadFileTool(fileSystemService);

            const externalPath1 = '/external/project/file1.ts';
            const externalPath2 = '/external/project/file2.ts';

            // First request - needs approval
            let override = await tool.getApprovalOverride?.(
                { file_path: externalPath1 },
                toolContext
            );
            expect(override).not.toBeNull();

            tool.onApprovalGranted?.(
                {
                    approvalId: 'approval-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                },
                toolContext
            );

            expect(
                approvalManager
                    .getApprovedDirectories()
                    .get(path.dirname(path.resolve(externalPath1)))
            ).toBe('session');

            // Second request - should not need approval (session approved)
            override = await tool.getApprovalOverride?.({ file_path: externalPath2 }, toolContext);
            expect(override).toBeNull();
        });

        it('should prompt for subsequent requests after once approval', async () => {
            const tool = createReadFileTool(fileSystemService);

            const externalPath1 = '/external/project/file1.ts';
            const externalPath2 = '/external/project/file2.ts';

            // First request - needs approval
            let override = await tool.getApprovalOverride?.(
                { file_path: externalPath1 },
                toolContext
            );
            expect(override).not.toBeNull();

            tool.onApprovalGranted?.(
                {
                    approvalId: 'approval-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: false },
                },
                toolContext
            );

            expect(
                approvalManager
                    .getApprovedDirectories()
                    .get(path.dirname(path.resolve(externalPath1)))
            ).toBe('once');

            // Second request - should still need approval (only 'once')
            override = await tool.getApprovalOverride?.({ file_path: externalPath2 }, toolContext);
            expect(override).not.toBeNull();
        });
    });

    // =====================================================================
    // PATH CONTAINMENT SCENARIOS
    // =====================================================================

    describe('Path Containment Scenarios', () => {
        it('should cover child paths when parent directory is session-approved', async () => {
            const tool = createReadFileTool(fileSystemService);
            approvalManager.addApprovedDirectory('/external/project', 'session');

            let override = await tool.getApprovalOverride?.(
                { file_path: '/external/project/file.ts' },
                toolContext
            );
            expect(override).toBeNull();

            override = await tool.getApprovalOverride?.(
                { file_path: '/external/project/deep/nested/file.ts' },
                toolContext
            );
            expect(override).toBeNull();
        });

        it('should NOT cover sibling directories', async () => {
            const tool = createReadFileTool(fileSystemService);
            approvalManager.addApprovedDirectory('/external/sub', 'session');

            let override = await tool.getApprovalOverride?.(
                { file_path: '/external/sub/file.ts' },
                toolContext
            );
            expect(override).toBeNull();

            override = await tool.getApprovalOverride?.(
                { file_path: '/external/other/file.ts' },
                toolContext
            );
            expect(override).not.toBeNull();
        });
    });

    // =====================================================================
    // DIFFERENT EXTERNAL DIRECTORIES SCENARIOS
    // =====================================================================

    describe('Different External Directories Scenarios', () => {
        it('should require separate approval for different external directories', async () => {
            const tool = createReadFileTool(fileSystemService);

            const dir1Path = '/external/project1/file.ts';
            const dir2Path = '/external/project2/file.ts';

            const override1 = await tool.getApprovalOverride?.(
                { file_path: dir1Path },
                toolContext
            );
            expect(override1).not.toBeNull();
            const metadata1 = override1?.metadata as any;
            expect(metadata1?.parentDir).toBe('/external/project1');

            const override2 = await tool.getApprovalOverride?.(
                { file_path: dir2Path },
                toolContext
            );
            expect(override2).not.toBeNull();
            const metadata2 = override2?.metadata as any;
            expect(metadata2?.parentDir).toBe('/external/project2');
        });
    });

    // =====================================================================
    // MIXED OPERATIONS SCENARIOS
    // =====================================================================

    describe('Mixed Operations Scenarios', () => {
        it('should share directory approval across different file operations', async () => {
            const readTool = createReadFileTool(fileSystemService);
            const writeTool = createWriteFileTool(fileSystemService);
            const editTool = createEditFileTool(fileSystemService);

            const externalDir = '/external/project';

            expect(
                await readTool.getApprovalOverride?.(
                    { file_path: `${externalDir}/file1.ts` },
                    toolContext
                )
            ).not.toBeNull();

            readTool.onApprovalGranted?.(
                {
                    approvalId: 'approval-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                },
                toolContext
            );

            expect(
                await writeTool.getApprovalOverride?.(
                    { file_path: `${externalDir}/file2.ts`, content: 'test' },
                    toolContext
                )
            ).toBeNull();
            expect(
                await editTool.getApprovalOverride?.(
                    { file_path: `${externalDir}/file3.ts`, old_string: 'a', new_string: 'b' },
                    toolContext
                )
            ).toBeNull();
        });
    });

    describe('Without ApprovalManager in context', () => {
        it('should return a directory access request but not remember approvals', async () => {
            const tool = createReadFileTool(fileSystemService);

            const override = await tool.getApprovalOverride?.({
                file_path: '/external/project/file.ts',
            });
            expect(override).not.toBeNull();

            tool.onApprovalGranted?.({
                approvalId: 'test-approval',
                status: ApprovalStatus.APPROVED,
                data: { rememberDirectory: true },
            });

            expect(approvalManager.getApprovedDirectoryPaths()).toEqual([]);
        });
    });
});
