import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import { createReadMediaFileTool } from './read-media-file-tool.js';

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

describe('read_media_file tool', () => {
    let mockLogger: Logger;
    let tempDir: string;
    let fileSystemService: FileSystemService;

    beforeEach(async () => {
        mockLogger = createMockLogger();

        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-read-media-test-'));
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
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup failures
        }
    });

    it('returns image content items for images', async () => {
        const tool = createReadMediaFileTool(async () => fileSystemService);
        const filePath = path.join(tempDir, 'poster.png');
        const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
        await fs.writeFile(filePath, buffer);

        const result = (await tool.execute(
            { file_path: filePath },
            createToolContext(mockLogger)
        )) as {
            content: Array<Record<string, unknown>>;
            mimeType: string;
        };

        expect(result.mimeType).toBe('image/png');
        expect(result.content).toEqual([
            {
                type: 'image',
                data: buffer.toString('base64'),
                mimeType: 'image/png',
                filename: 'poster.png',
            },
        ]);
    });

    it('returns file content items for audio, video, and document media', async () => {
        const tool = createReadMediaFileTool(async () => fileSystemService);
        const cases = [
            {
                filename: 'voice.mp3',
                bytes: Buffer.from([0x49, 0x44, 0x33, 0x00]),
                mimeType: 'audio/mpeg',
            },
            {
                filename: 'demo.mp4',
                bytes: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
                mimeType: 'video/mp4',
            },
            {
                filename: 'guide.pdf',
                bytes: Buffer.from('%PDF-1.7'),
                mimeType: 'application/pdf',
            },
        ] as const;

        for (const testCase of cases) {
            const filePath = path.join(tempDir, testCase.filename);
            await fs.writeFile(filePath, testCase.bytes);

            const result = (await tool.execute(
                { file_path: filePath },
                createToolContext(mockLogger)
            )) as {
                content: Array<Record<string, unknown>>;
                mimeType: string;
                filename: string;
            };

            expect(result.mimeType).toBe(testCase.mimeType);
            expect(result.filename).toBe(testCase.filename);
            expect(result.content).toEqual([
                {
                    type: 'file',
                    data: testCase.bytes.toString('base64'),
                    mimeType: testCase.mimeType,
                    filename: testCase.filename,
                },
            ]);
        }
    });
});
