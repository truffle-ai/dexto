import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
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

function createToolContext(logger: Logger): ToolExecutionContext {
    return { logger };
}

describe('grep_content tool', () => {
    let mockLogger: Logger;
    let tempDir: string;
    let fileSystemService: FileSystemService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-grep-test-'));
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

    it('expands home-directory shorthand for search paths', async () => {
        const homeTempDir = await fs.mkdtemp(path.join(os.homedir(), '.dexto-grep-home-test-'));
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
            await fs.writeFile(filePath, 'alpha\nneedle\nomega\n');

            const tool = createGrepContentTool(async () => fileSystemServiceForHome);
            const parsedInput = tool.inputSchema.parse({
                pattern: 'needle',
                path: `~/${path.basename(homeTempDir)}`,
            });
            const result = (await tool.execute(parsedInput, createToolContext(mockLogger))) as {
                matches: Array<{ file: string; line_number: number; line: string }>;
                files_searched: number;
            };

            expect(result.files_searched).toBe(1);
            expect(result.matches).toEqual([
                {
                    file: filePath,
                    line_number: 2,
                    line: 'needle',
                },
            ]);
        } finally {
            await fs.rm(homeTempDir, { recursive: true, force: true });
        }
    });
});
