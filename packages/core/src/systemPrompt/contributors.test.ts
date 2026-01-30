import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { FileContributor } from './contributors.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { DynamicContributorContext } from './types.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { SystemPromptErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

const mockLogger = createMockLogger();

describe('FileContributor', () => {
    const testDir = join(process.cwd(), 'test-files');
    const mockContext: DynamicContributorContext = {
        mcpManager: {} as any,
    };

    beforeEach(async () => {
        // Create test directory and files
        await mkdir(testDir, { recursive: true });

        // Create test files
        await writeFile(
            join(testDir, 'test1.md'),
            '# Test Document 1\n\nThis is the first test document.'
        );
        await writeFile(join(testDir, 'test2.txt'), 'This is a plain text file.\nSecond line.');
        await writeFile(join(testDir, 'large.md'), 'x'.repeat(200000)); // Large file for testing
        await writeFile(join(testDir, 'invalid.json'), '{"key": "value"}'); // Invalid file type
    });

    afterEach(async () => {
        // Clean up test files
        await rm(testDir, { recursive: true, force: true });
    });

    test('should read single markdown file with default options', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'test1.md')],
            {},
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toContain('<fileContext>');
        expect(result).toContain('test-files/test1.md');
        expect(result).toContain('# Test Document 1');
        expect(result).toContain('This is the first test document.');
        expect(result).toContain('</fileContext>');
    });

    test('should read multiple files with separator', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'test1.md'), join(testDir, 'test2.txt')],
            {
                separator: '\n\n===\n\n',
            },
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toContain('# Test Document 1');
        expect(result).toContain('This is a plain text file.');
        expect(result).toContain('===');
    });

    test('should handle missing files with skip mode', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'missing.md'), join(testDir, 'test1.md')],
            {
                errorHandling: 'skip',
            },
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toContain('# Test Document 1');
        expect(result).not.toContain('missing.md');
    });

    test('should handle missing files with error mode', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'missing.md'), join(testDir, 'test1.md')],
            {
                errorHandling: 'error',
            },
            mockLogger
        );

        const error = (await contributor
            .getContent(mockContext)
            .catch((e) => e)) as DextoRuntimeError;
        expect(error).toBeInstanceOf(DextoRuntimeError);
        expect(error.code).toBe(SystemPromptErrorCode.FILE_READ_FAILED);
        expect(error.scope).toBe(ErrorScope.SYSTEM_PROMPT);
        expect(error.type).toBe(ErrorType.SYSTEM);
    });

    test('should throw error for missing files with single file error mode', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'missing.md')],
            {
                errorHandling: 'error',
            },
            mockLogger
        );

        const error = (await contributor
            .getContent(mockContext)
            .catch((e) => e)) as DextoRuntimeError;
        expect(error).toBeInstanceOf(DextoRuntimeError);
        expect(error.code).toBe(SystemPromptErrorCode.FILE_READ_FAILED);
        expect(error.scope).toBe(ErrorScope.SYSTEM_PROMPT);
        expect(error.type).toBe(ErrorType.SYSTEM);
    });

    test('should skip large files with skip mode', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'large.md'), join(testDir, 'test1.md')],
            {
                maxFileSize: 1000,
                errorHandling: 'skip',
            },
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toContain('# Test Document 1');
        expect(result).not.toContain('large.md');
    });

    test('should handle invalid file types with skip mode', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'invalid.json'), join(testDir, 'test1.md')],
            {
                errorHandling: 'skip',
            },
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toContain('# Test Document 1');
        expect(result).not.toContain('invalid.json');
    });

    test('should throw error for invalid file types with error mode', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'invalid.json')],
            {
                errorHandling: 'error',
            },
            mockLogger
        );

        await expect(contributor.getContent(mockContext)).rejects.toThrow(
            'is not a .md or .txt file'
        );
    });

    test('should exclude filenames when configured', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'test1.md')],
            {
                includeFilenames: false,
            },
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toContain('# Test Document 1');
        expect(result).not.toContain('test-files/test1.md');
    });

    test('should include metadata when configured', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'test1.md')],
            {
                includeMetadata: true,
            },
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toContain('*File size:');
        expect(result).toContain('Modified:');
    });

    test('should return empty context when no files can be loaded', async () => {
        const contributor = new FileContributor(
            'test',
            0,
            [join(testDir, 'missing.md')],
            {
                errorHandling: 'skip',
            },
            mockLogger
        );
        const result = await contributor.getContent(mockContext);

        expect(result).toBe('<fileContext>No files could be loaded</fileContext>');
    });

    test('should read files using absolute paths from arbitrary directories', async () => {
        const configDir = join(testDir, 'config');
        await mkdir(configDir, { recursive: true });

        const absolutePath = join(configDir, 'config-file.md');
        await writeFile(absolutePath, '# Config File\n\nThis is a config file.');

        const contributor = new FileContributor('test', 0, [absolutePath], {}, mockLogger);

        const result = await contributor.getContent(mockContext);

        expect(result).toContain('<fileContext>');
        expect(result).toContain('config-file.md');
        expect(result).toContain('# Config File');
        expect(result).toContain('This is a config file.');
        expect(result).toContain('</fileContext>');
    });

    test('should read files from nested directories when given absolute paths', async () => {
        const configDir = join(testDir, 'config');
        const docsDir = join(configDir, 'docs');
        await mkdir(docsDir, { recursive: true });

        const nestedPath = join(docsDir, 'readme.md');
        await writeFile(nestedPath, '# Documentation\n\nThis is documentation.');

        const contributor = new FileContributor('test', 0, [nestedPath], {}, mockLogger);

        const result = await contributor.getContent(mockContext);

        expect(result).toContain('<fileContext>');
        expect(result).toContain('readme.md');
        expect(result).toContain('# Documentation');
        expect(result).toContain('This is documentation.');
        expect(result).toContain('</fileContext>');
    });
});
