import { describe, it, expect, vi } from 'vitest';
import { ToolErrorCode } from '@dexto/core';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import type { ToolServices } from '@dexto/core/tools';
import { createBlockedPathCheck } from './blocked-path-check.js';
import { createGlobFilesTool } from './glob-files-tool.js';
import { allowAllPaths } from './test-helpers.js';

const blockedPathCheck = createBlockedPathCheck({
    allowedPaths: ['.'],
    blockedPaths: ['.git', '.env'],
    blockedExtensions: [],
    maxFileSize: 1024,
    enableBackups: false,
    backupRetentionDays: 7,
});

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
    glob: (pattern: string) => Promise<string[]>
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
                readFile: vi.fn(async () => ''),
                readText: vi.fn(async () => ''),
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

describe('glob_files tool', () => {
    it('searches through WorkspaceManager.open without FileSystemService execution', async () => {
        const mockLogger = createMockLogger();
        const getFileSystemService = vi.fn(async () => {
            throw new Error('glob_files execute must not use FileSystemService');
        });
        const glob = vi.fn(async () => ['src/a.ts', 'src/b.ts', 'src/c.ts']);
        const tool = createGlobFilesTool(getFileSystemService, allowAllPaths);
        const parsedInput = tool.inputSchema.parse({
            pattern: '**/*.ts',
            path: 'src',
            max_results: 2,
        });

        const result = (await tool.execute(parsedInput, createToolContext(mockLogger, glob))) as {
            files: Array<{ path: string }>;
            total_found: number;
            truncated: boolean;
        };

        expect(getFileSystemService).not.toHaveBeenCalled();
        expect(glob).toHaveBeenCalledWith('src/**/*.ts');
        expect(result).toMatchObject({
            files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
            total_found: 2,
            truncated: true,
        });
    });

    it('normalizes workspace-contained absolute search paths before globbing', async () => {
        const mockLogger = createMockLogger();
        const glob = vi.fn(async () => ['src/a.ts']);
        const tool = createGlobFilesTool(vi.fn(), allowAllPaths);

        await tool.execute(
            tool.inputSchema.parse({
                pattern: '**/*.ts',
                path: '/repo/src',
            }),
            createToolContext(mockLogger, glob)
        );

        expect(glob).toHaveBeenCalledWith('src/**/*.ts');
    });

    it('rejects external absolute search paths before file provider calls', async () => {
        const mockLogger = createMockLogger();
        const glob = vi.fn(async () => ['src/a.ts']);
        const tool = createGlobFilesTool(vi.fn(), allowAllPaths);

        await expect(
            tool.execute(
                tool.inputSchema.parse({
                    pattern: '**/*.ts',
                    path: '/outside/src',
                }),
                createToolContext(mockLogger, glob)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });

        expect(glob).not.toHaveBeenCalled();
    });

    it('rejects absolute and escaping glob patterns before file provider calls', async () => {
        const mockLogger = createMockLogger();
        const glob = vi.fn(async () => ['src/a.ts']);
        const tool = createGlobFilesTool(vi.fn(), allowAllPaths);

        await expect(
            tool.execute(
                tool.inputSchema.parse({
                    pattern: '/outside/**/*.ts',
                }),
                createToolContext(mockLogger, glob)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });
        await expect(
            tool.execute(
                tool.inputSchema.parse({
                    pattern: '../**/*.ts',
                }),
                createToolContext(mockLogger, glob)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });

        expect(glob).not.toHaveBeenCalled();
    });

    it.each([
        '{..,src}/**/*.ts',
        '{.,.}{.,.}/secret.txt',
        '{/outside,src}/**/*.ts',
        'src/{a,../b}',
    ])('rejects brace pattern %s that expands to an escaping glob', async (pattern) => {
        const glob = vi.fn(async () => ['src/a.ts']);
        const tool = createGlobFilesTool(vi.fn(), allowAllPaths);

        await expect(
            tool.execute(
                tool.inputSchema.parse({ pattern }),
                createToolContext(createMockLogger(), glob)
            )
        ).rejects.toMatchObject({ code: ToolErrorCode.VALIDATION_FAILED });

        expect(glob).not.toHaveBeenCalled();
    });

    it('still accepts brace patterns that stay inside the workspace', async () => {
        const glob = vi.fn(async () => ['src/a.ts', 'src/b.tsx']);
        const tool = createGlobFilesTool(vi.fn(), allowAllPaths);

        await tool.execute(
            tool.inputSchema.parse({ pattern: 'src/**/*.{ts,tsx}' }),
            createToolContext(createMockLogger(), glob)
        );

        expect(glob).toHaveBeenCalledWith('src/**/*.{ts,tsx}');
    });

    it('leaves blocked files out of the results', async () => {
        const glob = vi.fn(async () => ['.env', 'sub/.env', 'sub/.git/config', 'src/a.ts']);
        const tool = createGlobFilesTool(vi.fn(), blockedPathCheck);

        const result = (await tool.execute(
            tool.inputSchema.parse({ pattern: '**/*' }),
            createToolContext(createMockLogger(), glob)
        )) as { files: Array<{ path: string }>; total_found: number };

        expect(result.files).toEqual([{ path: 'src/a.ts' }]);
        expect(result.total_found).toBe(1);
    });
});
