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

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createReadFileTool } from './read-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';
import { createEditFileTool } from './edit-file-tool.js';
import { FileSystemService } from './filesystem-service.js';
import type { DirectoryApprovalCallbacks, FileToolOptions } from './file-tool-types.js';
import { ApprovalType, ApprovalStatus } from '@dexto/core';

// Create mock logger
const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    createChild: vi.fn().mockReturnThis(),
});

describe('Directory Approval Integration Tests', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let tempDir: string;
    let fileSystemService: FileSystemService;
    let directoryApproval: DirectoryApprovalCallbacks;
    let isSessionApprovedMock: Mock;
    let addApprovedMock: Mock;

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
            mockLogger as any
        );
        await fileSystemService.initialize();

        // Create directory approval callbacks
        isSessionApprovedMock = vi.fn().mockReturnValue(false);
        addApprovedMock = vi.fn();
        directoryApproval = {
            isSessionApproved: isSessionApprovedMock,
            addApproved: addApprovedMock,
        };

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
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                // Create test file in working directory
                const testFile = path.join(tempDir, 'test.txt');
                await fs.writeFile(testFile, 'test content');

                const override = await tool.getApprovalOverride?.({ file_path: testFile });
                expect(override).toBeNull();
            });

            it('should return directory access approval for external paths', async () => {
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                // External path (outside working directory)
                const externalPath = '/external/project/file.ts';

                const override = await tool.getApprovalOverride?.({ file_path: externalPath });

                expect(override).not.toBeNull();
                expect(override?.type).toBe(ApprovalType.DIRECTORY_ACCESS);
                const metadata = override?.metadata as any;
                expect(metadata?.path).toBe(path.resolve(externalPath));
                expect(metadata?.parentDir).toBe(path.dirname(path.resolve(externalPath)));
                expect(metadata?.operation).toBe('read');
                expect(metadata?.toolName).toBe('read_file');
            });

            it('should return null when external path is session-approved', async () => {
                isSessionApprovedMock.mockReturnValue(true);

                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/file.ts';

                const override = await tool.getApprovalOverride?.({ file_path: externalPath });
                expect(override).toBeNull();
                expect(isSessionApprovedMock).toHaveBeenCalledWith(externalPath);
            });

            it('should return null when file_path is missing', async () => {
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const override = await tool.getApprovalOverride?.({});
                expect(override).toBeNull();
            });
        });

        describe('onApprovalGranted', () => {
            it('should add directory as session-approved when rememberDirectory is true', async () => {
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                // First trigger getApprovalOverride to set pendingApprovalParentDir
                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath });

                // Then call onApprovalGranted with rememberDirectory: true
                tool.onApprovalGranted?.({
                    approvalId: 'test-approval',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                expect(addApprovedMock).toHaveBeenCalledWith(
                    path.dirname(path.resolve(externalPath)),
                    'session'
                );
            });

            it('should add directory as once-approved when rememberDirectory is false', async () => {
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath });

                tool.onApprovalGranted?.({
                    approvalId: 'test-approval',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: false },
                });

                expect(addApprovedMock).toHaveBeenCalledWith(
                    path.dirname(path.resolve(externalPath)),
                    'once'
                );
            });

            it('should default to once-approved when rememberDirectory is not specified', async () => {
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath });

                tool.onApprovalGranted?.({
                    approvalId: 'test-approval',
                    status: ApprovalStatus.APPROVED,
                    data: {},
                });

                expect(addApprovedMock).toHaveBeenCalledWith(
                    path.dirname(path.resolve(externalPath)),
                    'once'
                );
            });

            it('should not call addApproved when directoryApproval is not provided', async () => {
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval: undefined,
                });

                const externalPath = '/external/project/file.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath });

                // Should not throw
                tool.onApprovalGranted?.({
                    approvalId: 'test-approval',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                expect(addApprovedMock).not.toHaveBeenCalled();
            });
        });

        describe('execute', () => {
            it('should read file contents within working directory', async () => {
                const tool = createReadFileTool({
                    fileSystemService,
                    directoryApproval,
                });

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
                const tool = createWriteFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const testFile = path.join(tempDir, 'new-file.txt');

                const override = await tool.getApprovalOverride?.({
                    file_path: testFile,
                    content: 'test',
                });
                expect(override).toBeNull();
            });

            it('should return directory access approval for external paths', async () => {
                const tool = createWriteFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/new.ts';

                const override = await tool.getApprovalOverride?.({
                    file_path: externalPath,
                    content: 'test',
                });

                expect(override).not.toBeNull();
                expect(override?.type).toBe(ApprovalType.DIRECTORY_ACCESS);
                const metadata = override?.metadata as any;
                expect(metadata?.operation).toBe('write');
                expect(metadata?.toolName).toBe('write_file');
            });

            it('should return null when external path is session-approved', async () => {
                isSessionApprovedMock.mockReturnValue(true);

                const tool = createWriteFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/new.ts';

                const override = await tool.getApprovalOverride?.({
                    file_path: externalPath,
                    content: 'test',
                });
                expect(override).toBeNull();
            });
        });

        describe('onApprovalGranted', () => {
            it('should add directory as session-approved when rememberDirectory is true', async () => {
                const tool = createWriteFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/new.ts';
                await tool.getApprovalOverride?.({ file_path: externalPath, content: 'test' });

                tool.onApprovalGranted?.({
                    approvalId: 'test-approval',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                });

                expect(addApprovedMock).toHaveBeenCalledWith(
                    path.dirname(path.resolve(externalPath)),
                    'session'
                );
            });
        });
    });

    // =====================================================================
    // EDIT FILE TOOL TESTS
    // =====================================================================

    describe('Edit File Tool', () => {
        describe('getApprovalOverride', () => {
            it('should return null for paths within working directory', async () => {
                const tool = createEditFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const testFile = path.join(tempDir, 'existing.txt');

                const override = await tool.getApprovalOverride?.({
                    file_path: testFile,
                    old_string: 'old',
                    new_string: 'new',
                });
                expect(override).toBeNull();
            });

            it('should return directory access approval for external paths', async () => {
                const tool = createEditFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/existing.ts';

                const override = await tool.getApprovalOverride?.({
                    file_path: externalPath,
                    old_string: 'old',
                    new_string: 'new',
                });

                expect(override).not.toBeNull();
                expect(override?.type).toBe(ApprovalType.DIRECTORY_ACCESS);
                const metadata = override?.metadata as any;
                expect(metadata?.operation).toBe('edit');
                expect(metadata?.toolName).toBe('edit_file');
            });

            it('should return null when external path is session-approved', async () => {
                isSessionApprovedMock.mockReturnValue(true);

                const tool = createEditFileTool({
                    fileSystemService,
                    directoryApproval,
                });

                const externalPath = '/external/project/existing.ts';

                const override = await tool.getApprovalOverride?.({
                    file_path: externalPath,
                    old_string: 'old',
                    new_string: 'new',
                });
                expect(override).toBeNull();
            });
        });
    });

    // =====================================================================
    // SESSION VS ONCE APPROVAL SCENARIOS
    // =====================================================================

    describe('Session vs Once Approval Scenarios', () => {
        it('should not prompt for subsequent requests after session approval', async () => {
            const tool = createReadFileTool({
                fileSystemService,
                directoryApproval,
            });

            const externalPath1 = '/external/project/file1.ts';
            const externalPath2 = '/external/project/file2.ts';

            // First request - needs approval
            let override = await tool.getApprovalOverride?.({ file_path: externalPath1 });
            expect(override).not.toBeNull();

            // Simulate session approval
            tool.onApprovalGranted?.({
                approvalId: 'approval-1',
                status: ApprovalStatus.APPROVED,
                data: { rememberDirectory: true },
            });

            // Verify addApproved was called with 'session'
            expect(addApprovedMock).toHaveBeenCalledWith(
                path.dirname(path.resolve(externalPath1)),
                'session'
            );

            // Now simulate that isSessionApproved returns true for the approved directory
            isSessionApprovedMock.mockReturnValue(true);

            // Second request - should not need approval (session approved)
            override = await tool.getApprovalOverride?.({ file_path: externalPath2 });
            expect(override).toBeNull();
        });

        it('should prompt for subsequent requests after once approval', async () => {
            const tool = createReadFileTool({
                fileSystemService,
                directoryApproval,
            });

            const externalPath1 = '/external/project/file1.ts';
            const externalPath2 = '/external/project/file2.ts';

            // First request - needs approval
            let override = await tool.getApprovalOverride?.({ file_path: externalPath1 });
            expect(override).not.toBeNull();

            // Simulate once approval
            tool.onApprovalGranted?.({
                approvalId: 'approval-1',
                status: ApprovalStatus.APPROVED,
                data: { rememberDirectory: false },
            });

            // Verify addApproved was called with 'once'
            expect(addApprovedMock).toHaveBeenCalledWith(
                path.dirname(path.resolve(externalPath1)),
                'once'
            );

            // isSessionApproved stays false for 'once' approvals
            isSessionApprovedMock.mockReturnValue(false);

            // Second request - should still need approval (only 'once')
            override = await tool.getApprovalOverride?.({ file_path: externalPath2 });
            expect(override).not.toBeNull();
        });
    });

    // =====================================================================
    // PATH CONTAINMENT SCENARIOS
    // =====================================================================

    describe('Path Containment Scenarios', () => {
        it('should cover child paths when parent directory is session-approved', async () => {
            const tool = createReadFileTool({
                fileSystemService,
                directoryApproval,
            });

            // isSessionApproved checks if file is within any session-approved directory
            // If /external/project is session-approved, /external/project/deep/file.ts should also be covered
            isSessionApprovedMock.mockImplementation((filePath: string) => {
                const normalizedPath = path.resolve(filePath);
                const approvedDir = '/external/project';
                return (
                    normalizedPath.startsWith(approvedDir + path.sep) ||
                    normalizedPath === approvedDir
                );
            });

            // Direct child path - should be approved
            let override = await tool.getApprovalOverride?.({
                file_path: '/external/project/file.ts',
            });
            expect(override).toBeNull();

            // Deep nested path - should also be approved
            override = await tool.getApprovalOverride?.({
                file_path: '/external/project/deep/nested/file.ts',
            });
            expect(override).toBeNull();
        });

        it('should NOT cover sibling directories', async () => {
            const tool = createReadFileTool({
                fileSystemService,
                directoryApproval,
            });

            // Only /external/sub is approved
            isSessionApprovedMock.mockImplementation((filePath: string) => {
                const normalizedPath = path.resolve(filePath);
                const approvedDir = '/external/sub';
                return (
                    normalizedPath.startsWith(approvedDir + path.sep) ||
                    normalizedPath === approvedDir
                );
            });

            // /external/sub path - approved
            let override = await tool.getApprovalOverride?.({ file_path: '/external/sub/file.ts' });
            expect(override).toBeNull();

            // /external/other path - NOT approved (sibling directory)
            override = await tool.getApprovalOverride?.({ file_path: '/external/other/file.ts' });
            expect(override).not.toBeNull();
        });
    });

    // =====================================================================
    // DIFFERENT EXTERNAL DIRECTORIES SCENARIOS
    // =====================================================================

    describe('Different External Directories Scenarios', () => {
        it('should require separate approval for different external directories', async () => {
            const tool = createReadFileTool({
                fileSystemService,
                directoryApproval,
            });

            const dir1Path = '/external/project1/file.ts';
            const dir2Path = '/external/project2/file.ts';

            // Both directories need approval
            const override1 = await tool.getApprovalOverride?.({ file_path: dir1Path });
            expect(override1).not.toBeNull();
            const metadata1 = override1?.metadata as any;
            expect(metadata1?.parentDir).toBe('/external/project1');

            const override2 = await tool.getApprovalOverride?.({ file_path: dir2Path });
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
            const readTool = createReadFileTool({ fileSystemService, directoryApproval });
            const writeTool = createWriteFileTool({ fileSystemService, directoryApproval });
            const editTool = createEditFileTool({ fileSystemService, directoryApproval });

            const externalDir = '/external/project';

            // All operations need approval initially
            expect(
                await readTool.getApprovalOverride?.({ file_path: `${externalDir}/file1.ts` })
            ).not.toBeNull();
            expect(
                await writeTool.getApprovalOverride?.({
                    file_path: `${externalDir}/file2.ts`,
                    content: 'test',
                })
            ).not.toBeNull();
            expect(
                await editTool.getApprovalOverride?.({
                    file_path: `${externalDir}/file3.ts`,
                    old_string: 'a',
                    new_string: 'b',
                })
            ).not.toBeNull();

            // Simulate session approval for the directory
            isSessionApprovedMock.mockReturnValue(true);

            // Now all operations should not need approval
            expect(
                await readTool.getApprovalOverride?.({ file_path: `${externalDir}/file1.ts` })
            ).toBeNull();
            expect(
                await writeTool.getApprovalOverride?.({
                    file_path: `${externalDir}/file2.ts`,
                    content: 'test',
                })
            ).toBeNull();
            expect(
                await editTool.getApprovalOverride?.({
                    file_path: `${externalDir}/file3.ts`,
                    old_string: 'a',
                    new_string: 'b',
                })
            ).toBeNull();
        });
    });

    // =====================================================================
    // NO DIRECTORY APPROVAL CALLBACKS SCENARIOS
    // =====================================================================

    describe('Without Directory Approval Callbacks', () => {
        it('should work without directory approval callbacks (all paths need normal tool confirmation)', async () => {
            const tool = createReadFileTool({
                fileSystemService,
                directoryApproval: undefined,
            });

            // External path without approval callbacks - no override (normal tool flow)
            const override = await tool.getApprovalOverride?.({
                file_path: '/external/project/file.ts',
            });

            // Without directoryApproval, isSessionApproved is never checked, so we fall through to
            // returning a directory access request. Let me re-check the implementation...
            // Actually looking at the code, when directoryApproval is undefined, isSessionApproved check
            // is skipped (directoryApproval?.isSessionApproved), so it would still return the override.
            // This is correct behavior - without approval callbacks, the override is still returned
            // but onApprovalGranted won't do anything.
            expect(override).not.toBeNull();
        });
    });
});
