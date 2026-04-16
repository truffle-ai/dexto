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
    ApprovalStatus,
    DextoRuntimeError,
    type Logger,
    type ToolExecutionContext,
} from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import { createReadFileTool } from './read-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';
import { createEditFileTool } from './edit-file-tool.js';
import { fileSystemToolsFactory } from './tool-factory.js';

type ToolServices = NonNullable<ToolExecutionContext['services']>;
type SessionApprovalStore = ConstructorParameters<typeof ApprovalManager>[2];

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
        createFileOnlyChild: () => logger,
        setLevel: vi.fn(),
        getLevel: () => 'info',
        getLogFilePath: () => null,
        destroy: noopAsync,
    };

    return logger;
};

function createInMemorySessionApprovalStore(): SessionApprovalStore {
    const states = new Map<
        string,
        {
            toolPatterns: Record<string, string[]>;
            approvedDirectories: Array<{ path: string; type: 'session' | 'once' }>;
        }
    >();

    return {
        async load(sessionId?: string) {
            return structuredClone(
                states.get(sessionId ?? '__global__') ?? {
                    toolPatterns: {},
                    approvedDirectories: [],
                }
            );
        },
        async save(
            sessionId: string | undefined,
            state: {
                toolPatterns: Record<string, string[]>;
                approvedDirectories: Array<{ path: string; type: 'session' | 'once' }>;
            }
        ) {
            states.set(sessionId ?? '__global__', structuredClone(state));
        },
        async delete(sessionId?: string) {
            states.delete(sessionId ?? '__global__');
        },
    } as SessionApprovalStore;
}

function createToolContext(
    logger: Logger,
    approval: ApprovalManager,
    sessionId?: string
): ToolExecutionContext {
    return {
        logger,
        ...(sessionId !== undefined ? { sessionId } : {}),
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
            mockLogger,
            createInMemorySessionApprovalStore()
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
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();

            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'test content');

            const metadata = await overrideFn!(
                tool.inputSchema.parse({ file_path: testFile }),
                toolContext
            );
            expect(metadata).toBeNull();
        });

        it('should return directory access metadata for external paths', async () => {
            const tool = createReadFileTool(getFileSystemService);
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();

            const externalPath = '/external/project/file.ts';

            const metadata = await overrideFn!(
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
            await approvalManager.addApprovedDirectory('/external/project', 'session');

            const tool = createReadFileTool(getFileSystemService);
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();
            const externalPath = '/external/project/file.ts';

            const metadata = await overrideFn!(
                tool.inputSchema.parse({ file_path: externalPath }),
                toolContext
            );
            expect(metadata).toBeNull();
        });

        it('should still return metadata when external path is once-approved (prompt again)', async () => {
            await approvalManager.addApprovedDirectory('/external/project', 'once');

            const tool = createReadFileTool(getFileSystemService);
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();
            const externalPath = '/external/project/file.ts';

            const metadata = await overrideFn!(
                tool.inputSchema.parse({ file_path: externalPath }),
                toolContext
            );
            expect(metadata).not.toBeNull();
        });

        it('should remember directory approvals only for the granting session', async () => {
            const tool = createReadFileTool(getFileSystemService);
            const overrideFn = tool.approval?.override;
            const onGrantedFn = tool.approval?.onGranted;
            expect(overrideFn).toBeDefined();
            expect(onGrantedFn).toBeDefined();

            const externalPath = '/external/project/file.ts';
            const sessionAContext = createToolContext(mockLogger, approvalManager, 'session-a');
            const sessionBContext = createToolContext(mockLogger, approvalManager, 'session-b');

            const approvalRequest = await overrideFn!(
                tool.inputSchema.parse({ file_path: externalPath }),
                sessionAContext
            );
            expect(approvalRequest).not.toBeNull();

            await onGrantedFn!(
                {
                    approvalId: 'approval-1',
                    status: ApprovalStatus.APPROVED,
                    data: { rememberDirectory: true },
                },
                sessionAContext,
                approvalRequest!
            );

            expect(
                await overrideFn!(
                    tool.inputSchema.parse({ file_path: externalPath }),
                    sessionAContext
                )
            ).toBeNull();
            expect(
                await overrideFn!(
                    tool.inputSchema.parse({ file_path: externalPath }),
                    sessionBContext
                )
            ).not.toBeNull();
        });
    });

    describe('Different tool operations', () => {
        it('should label write operations correctly', async () => {
            const tool = createWriteFileTool(getFileSystemService);
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();
            const externalPath = '/external/project/new.ts';

            const metadata = await overrideFn!(
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
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();
            const externalPath = '/external/project/existing.ts';

            const metadata = await overrideFn!(
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
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();
            await approvalManager.addApprovedDirectory('/external/project', 'session');

            const metadata1 = await overrideFn!(
                tool.inputSchema.parse({ file_path: '/external/project/file.ts' }),
                toolContext
            );
            expect(metadata1).toBeNull();

            const metadata2 = await overrideFn!(
                tool.inputSchema.parse({ file_path: '/external/project/deep/nested/file.ts' }),
                toolContext
            );
            expect(metadata2).toBeNull();
        });

        it('should NOT cover sibling directories', async () => {
            const tool = createReadFileTool(getFileSystemService);
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();
            await approvalManager.addApprovedDirectory('/external/sub', 'session');

            const metadata1 = await overrideFn!(
                tool.inputSchema.parse({ file_path: '/external/sub/file.ts' }),
                toolContext
            );
            expect(metadata1).toBeNull();

            const metadata2 = await overrideFn!(
                tool.inputSchema.parse({ file_path: '/external/other/file.ts' }),
                toolContext
            );
            expect(metadata2).not.toBeNull();
        });
    });

    describe('Execution approval scoping', () => {
        it('should allow execution only for the session that holds the approved directory', async () => {
            const tools = fileSystemToolsFactory.create({
                type: 'filesystem-tools',
                allowedPaths: [tempDir],
                blockedPaths: [],
                blockedExtensions: [],
                maxFileSize: 10 * 1024 * 1024,
                workingDirectory: tempDir,
                enableBackups: false,
                backupRetentionDays: 7,
            });
            const writeTool = tools.find((tool) => tool.id === 'write_file');
            expect(writeTool).toBeDefined();

            const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-fs-external-'));
            try {
                const externalFile = path.join(externalDir, 'approved.txt');

                await approvalManager.addApprovedDirectory(externalDir, 'once', 'session-a');

                await expect(
                    writeTool!.execute!(
                        writeTool!.inputSchema.parse({
                            file_path: externalFile,
                            content: 'session-scoped write',
                        }),
                        createToolContext(mockLogger, approvalManager, 'session-a')
                    )
                ).resolves.toEqual(
                    expect.objectContaining({
                        success: true,
                        path: path.resolve(externalFile),
                    })
                );

                await expect(fs.readFile(externalFile, 'utf8')).resolves.toBe(
                    'session-scoped write'
                );

                await expect(
                    writeTool!.execute!(
                        writeTool!.inputSchema.parse({
                            file_path: path.join(externalDir, 'blocked.txt'),
                            content: 'should fail',
                        }),
                        createToolContext(mockLogger, approvalManager, 'session-b')
                    )
                ).rejects.toBeInstanceOf(DextoRuntimeError);
            } finally {
                await fs.rm(externalDir, { recursive: true, force: true });
            }
        });
    });

    describe('Factory service scoping', () => {
        it('should keep working directories isolated across concurrent executions', async () => {
            const workspaceA = path.join(tempDir, 'workspace-a');
            const workspaceB = path.join(tempDir, 'workspace-b');
            await fs.mkdir(workspaceA, { recursive: true });
            await fs.mkdir(workspaceB, { recursive: true });
            await fs.writeFile(path.join(workspaceA, 'same.txt'), 'from workspace A');
            await fs.writeFile(path.join(workspaceB, 'same.txt'), 'from workspace B');

            const tools = fileSystemToolsFactory.create({
                type: 'filesystem-tools',
                allowedPaths: [workspaceA, workspaceB],
                blockedPaths: [],
                blockedExtensions: [],
                maxFileSize: 10 * 1024 * 1024,
                workingDirectory: tempDir,
                enableBackups: false,
                backupRetentionDays: 7,
                enabledTools: ['read_file'],
            });
            const readTool = tools.find((tool) => tool.id === 'read_file');
            expect(readTool).toBeDefined();

            const baseContext = createToolContext(mockLogger, approvalManager);
            const contextA: ToolExecutionContext = {
                ...baseContext,
                sessionId: 'session-a',
                workspace: {
                    id: 'workspace-a',
                    path: workspaceA,
                    createdAt: Date.now(),
                    lastActiveAt: Date.now(),
                },
            };
            const contextB: ToolExecutionContext = {
                ...baseContext,
                sessionId: 'session-b',
                workspace: {
                    id: 'workspace-b',
                    path: workspaceB,
                    createdAt: Date.now(),
                    lastActiveAt: Date.now(),
                },
            };

            const [resultA, resultB] = await Promise.all([
                readTool!.execute!(
                    readTool!.inputSchema.parse({ file_path: 'same.txt' }),
                    contextA
                ),
                readTool!.execute!(
                    readTool!.inputSchema.parse({ file_path: 'same.txt' }),
                    contextB
                ),
            ]);

            expect(resultA).toEqual(
                expect.objectContaining({
                    content: 'from workspace A',
                })
            );
            expect(resultB).toEqual(
                expect.objectContaining({
                    content: 'from workspace B',
                })
            );
        });

        it('should not mutate an injected filesystem service with session-specific state', async () => {
            const workspace = path.join(tempDir, 'workspace-injected');
            await fs.mkdir(workspace, { recursive: true });
            await fs.writeFile(path.join(workspace, 'same.txt'), 'from injected config');

            const tools = fileSystemToolsFactory.create({
                type: 'filesystem-tools',
                allowedPaths: [workspace],
                blockedPaths: [],
                blockedExtensions: [],
                maxFileSize: 10 * 1024 * 1024,
                workingDirectory: tempDir,
                enableBackups: false,
                backupRetentionDays: 7,
                enabledTools: ['read_file'],
            });
            const readTool = tools.find((tool) => tool.id === 'read_file');
            expect(readTool).toBeDefined();

            const injectedService = {
                getConfig: vi.fn().mockReturnValue({
                    allowedPaths: [workspace],
                    blockedPaths: [],
                    blockedExtensions: [],
                    maxFileSize: 10 * 1024 * 1024,
                    workingDirectory: workspace,
                    enableBackups: false,
                    backupRetentionDays: 7,
                }),
                readFile: vi.fn(),
                writeFile: vi.fn(),
                setWorkingDirectory: vi.fn(),
                setDirectoryApprovalChecker: vi.fn(),
            };

            const baseContext = createToolContext(mockLogger, approvalManager, 'session-a');
            const context: ToolExecutionContext = {
                ...baseContext,
                workspace: {
                    id: 'workspace-injected',
                    path: workspace,
                    createdAt: Date.now(),
                    lastActiveAt: Date.now(),
                },
                services: {
                    ...baseContext.services,
                    filesystemService: injectedService,
                } as ToolExecutionContext['services'],
            };

            const result = await readTool!.execute!(
                readTool!.inputSchema.parse({ file_path: 'same.txt' }),
                context
            );

            expect(result).toEqual(
                expect.objectContaining({
                    content: 'from injected config',
                })
            );
            expect(injectedService.setWorkingDirectory).not.toHaveBeenCalled();
            expect(injectedService.setDirectoryApprovalChecker).not.toHaveBeenCalled();
        });
    });

    describe('Without ApprovalManager in context', () => {
        it('should throw for external paths', async () => {
            const tool = createReadFileTool(getFileSystemService);
            const overrideFn = tool.approval?.override;
            expect(overrideFn).toBeDefined();

            const contextWithoutApprovalManager: ToolExecutionContext = { logger: mockLogger };
            await expect(
                overrideFn!(
                    tool.inputSchema.parse({ file_path: '/external/project/file.ts' }),
                    contextWithoutApprovalManager
                )
            ).rejects.toBeInstanceOf(DextoRuntimeError);
        });
    });
});
