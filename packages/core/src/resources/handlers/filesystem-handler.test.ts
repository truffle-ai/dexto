import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSystemResourceHandler } from './filesystem-handler.js';

const createMockLogger = () => {
    const logger = {
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

describe('FileSystemResourceHandler', () => {
    let tempDir: string;

    beforeEach(async () => {
        const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-fs-resource-test-'));
        tempDir = await fs.realpath(rawTempDir);
    });

    afterEach(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup failures
        }
    });

    it('returns binary resources as MIME-aware blobs instead of placeholder text', async () => {
        const logger = createMockLogger();
        const handler = new FileSystemResourceHandler(
            {
                type: 'filesystem',
                paths: [tempDir],
                maxDepth: 2,
                maxFiles: 100,
                includeHidden: false,
                includeExtensions: ['.png', '.txt'],
            },
            logger as any
        );
        await handler.initialize({ blobStore: {} as any });

        const filePath = path.join(tempDir, 'diagram.png');
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
        await fs.writeFile(filePath, bytes);

        const result = await handler.readResource(`fs://${filePath}`);

        expect(result.contents).toEqual([
            {
                uri: `fs://${filePath}`,
                mimeType: 'image/png',
                blob: bytes.toString('base64'),
            },
        ]);
        expect(result._meta).toEqual(
            expect.objectContaining({
                isBinary: true,
                size: bytes.length,
                originalMimeType: 'image/png',
                originalName: 'diagram.png',
            })
        );
    });

    it('keeps text resources as text and includes originalName metadata', async () => {
        const logger = createMockLogger();
        const handler = new FileSystemResourceHandler(
            {
                type: 'filesystem',
                paths: [tempDir],
                maxDepth: 2,
                maxFiles: 100,
                includeHidden: false,
                includeExtensions: ['.txt'],
            },
            logger as any
        );
        await handler.initialize({ blobStore: {} as any });

        const filePath = path.join(tempDir, 'notes.txt');
        await fs.writeFile(filePath, 'hello from resources');

        const result = await handler.readResource(`fs://${filePath}`);

        expect(result.contents).toEqual([
            {
                uri: `fs://${filePath}`,
                mimeType: 'text/plain',
                text: 'hello from resources',
            },
        ]);
        expect(result._meta).toEqual(
            expect.objectContaining({
                size: 20,
                originalName: 'notes.txt',
            })
        );
    });
});
