import { describe, it, expect, vi } from 'vitest';
import { ToolErrorCode } from '@dexto/core';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import type { ToolServices } from '@dexto/core/tools';
import { WorkspaceError } from '@dexto/core/workspace';
import { createGrepContentTool } from './grep-content-tool.js';

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
    filesByPath: Record<string, string>,
    glob = vi.fn(async () => Object.keys(filesByPath))
): ToolExecutionContext {
    const workspaceManager = {
        open: vi.fn(async () => ({
            context: {
                id: 'test-workspace',
                path: '/repo',
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            },
            capabilities: ['files' as const],
            files: {
                readFile: async (filePath: string) => readTestFile(filesByPath, filePath),
                readText: async (filePath: string) => readTestFile(filesByPath, filePath),
                glob,
                writeFile: vi.fn(async () => undefined),
                listFiles: vi.fn(async () => []),
            },
        })),
    };

    return {
        logger,
        services: {
            approval: {} as ToolServices['approval'],
            search: {} as ToolServices['search'],
            resources: {} as ToolServices['resources'],
            prompts: {} as ToolServices['prompts'],
            skills: {} as ToolServices['skills'],
            mcp: {} as ToolServices['mcp'],
            taskForker: null,
            workspaceManager: workspaceManager as unknown as ToolServices['workspaceManager'],
        },
    };
}

function readTestFile(filesByPath: Record<string, string>, filePath: string): string {
    const content = filesByPath[filePath];
    if (content === undefined) {
        throw WorkspaceError.fileNotFound(filePath);
    }
    return content;
}

describe('grep_content tool', () => {
    it('searches content through WorkspaceManager.open without FileSystemService execution', async () => {
        const mockLogger = createMockLogger();
        const getFileSystemService = vi.fn(async () => {
            throw new Error('grep_content execute must not use FileSystemService');
        });
        const glob = vi.fn(async () => ['src/notes.txt']);
        const tool = createGrepContentTool(getFileSystemService);
        const parsedInput = tool.inputSchema.parse({
            pattern: 'needle',
            path: 'src',
            glob: '**/*.txt',
            context_lines: 1,
        });

        const result = (await tool.execute(
            parsedInput,
            createToolContext(mockLogger, { 'src/notes.txt': 'alpha\nneedle\nomega\n' }, glob)
        )) as {
            matches: Array<{
                file: string;
                line_number: number;
                line: string;
                context?: { before: string[]; after: string[] };
            }>;
            files_searched: number;
        };

        expect(getFileSystemService).not.toHaveBeenCalled();
        expect(glob).toHaveBeenCalledWith('src/**/*.txt');
        expect(result.files_searched).toBe(1);
        expect(result.matches).toEqual([
            {
                file: 'src/notes.txt',
                line_number: 2,
                line: 'needle',
                context: {
                    before: ['alpha'],
                    after: ['omega'],
                },
            },
        ]);
    });

    it('normalizes workspace-contained absolute search paths before globbing', async () => {
        const mockLogger = createMockLogger();
        const glob = vi.fn(async () => ['src/notes.txt']);
        const tool = createGrepContentTool(vi.fn());

        await tool.execute(
            tool.inputSchema.parse({
                pattern: 'needle',
                path: '/repo/src',
                glob: '**/*.txt',
            }),
            createToolContext(mockLogger, { 'src/notes.txt': 'needle' }, glob)
        );

        expect(glob).toHaveBeenCalledWith('src/**/*.txt');
    });

    it('rejects external absolute search paths before file provider calls', async () => {
        const mockLogger = createMockLogger();
        const glob = vi.fn(async () => ['src/notes.txt']);
        const tool = createGrepContentTool(vi.fn());

        await expect(
            tool.execute(
                tool.inputSchema.parse({
                    pattern: 'needle',
                    path: '/outside/src',
                    glob: '**/*.txt',
                }),
                createToolContext(mockLogger, { 'src/notes.txt': 'needle' }, glob)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });

        expect(glob).not.toHaveBeenCalled();
    });

    it('rejects absolute and escaping glob filters before file provider calls', async () => {
        const mockLogger = createMockLogger();
        const glob = vi.fn(async () => ['src/notes.txt']);
        const tool = createGrepContentTool(vi.fn());

        await expect(
            tool.execute(
                tool.inputSchema.parse({
                    pattern: 'needle',
                    glob: '/outside/**/*.txt',
                }),
                createToolContext(mockLogger, { 'src/notes.txt': 'needle' }, glob)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });
        await expect(
            tool.execute(
                tool.inputSchema.parse({
                    pattern: 'needle',
                    glob: '../**/*.txt',
                }),
                createToolContext(mockLogger, { 'src/notes.txt': 'needle' }, glob)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });

        expect(glob).not.toHaveBeenCalled();
    });
});
