import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import { createGlobFilesTool } from './glob-files-tool.js';

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

function createToolContext(logger: Logger): ToolExecutionContext {
    return { logger };
}

describe('glob_files tool', () => {
    let mockLogger: Logger;
    let tempDir: string;
    let fileSystemService: FileSystemService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-glob-test-'));
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
    });

    afterEach(async () => {
        vi.restoreAllMocks();

        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup failures
        }
    });

    it('expands home-directory shorthand for glob base paths', async () => {
        const homeTempDir = await fs.mkdtemp(path.join(os.homedir(), '.dexto-glob-home-test-'));
        const fileSystemServiceForHome = new FileSystemService(
            {
                allowedPaths: [homeTempDir],
                blockedPaths: [],
                blockedExtensions: [],
                maxFileSize: 10 * 1024 * 1024,
                workingDirectory: tempDir,
                enableBackups: false,
                backupRetentionDays: 7,
            },
            mockLogger
        );
        await fileSystemServiceForHome.initialize();

        try {
            const filePath = path.join(homeTempDir, 'notes.txt');
            await fs.writeFile(filePath, 'hello');

            const tool = createGlobFilesTool(async () => fileSystemServiceForHome);
            const parsedInput = tool.inputSchema.parse({
                pattern: '**/*.txt',
                path: `~/${path.basename(homeTempDir)}`,
            });
            const result = (await tool.execute(parsedInput, createToolContext(mockLogger))) as {
                files: Array<{ path: string }>;
                total_found: number;
            };

            expect(result.total_found).toBe(1);
            expect(result.files).toEqual([
                {
                    path: filePath,
                    size: 5,
                    modified: expect.any(String),
                },
            ]);
        } finally {
            await fs.rm(homeTempDir, { recursive: true, force: true });
        }
    });
});
