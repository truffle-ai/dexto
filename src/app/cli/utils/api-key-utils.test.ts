import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir, homedir } from 'os';
import { updateEnvFileWithLLMKeys } from './api-key-utils.js';

// Mock homedir to control global .dexto location
vi.mock('os', async () => {
    const actual = await vi.importActual('os');
    return {
        ...actual,
        homedir: vi.fn(),
    };
});

describe('API Key Utils', () => {
    let tempDir: string;
    let mockHomeDir: string;

    beforeEach(async () => {
        // Create a temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-api-key-test-'));

        // Create mock home directory
        mockHomeDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-mock-home-'));

        // Mock homedir to return our test directory
        vi.mocked(homedir).mockReturnValue(mockHomeDir);
    });

    afterEach(async () => {
        // Cleanup the temporary directories
        await fs.rm(tempDir, { recursive: true, force: true });
        await fs.rm(mockHomeDir, { recursive: true, force: true });

        vi.clearAllMocks();
    });

    describe('updateEnvFileWithLLMKeys', () => {
        it('creates a new .env file with the Dexto env section when none exists', async () => {
            const envFilePath = path.join(tempDir, '.env');
            await updateEnvFileWithLLMKeys(envFilePath, 'openai', 'key1');
            const result = await fs.readFile(path.join(tempDir, '.env'), 'utf8');
            const expected = [
                '',
                '## Dexto env variables',
                'OPENAI_API_KEY=key1',
                'ANTHROPIC_API_KEY=',
                'GOOGLE_GENERATIVE_AI_API_KEY=',
                'GROQ_API_KEY=',
                'DEXTO_LOG_LEVEL=info',
                '',
            ].join('\n');
            expect(result).toBe(expected);
        });

        it('updates existing .env preserving unrelated lines and replacing Dexto section', async () => {
            // Prepare an existing .env with unrelated and old Dexto section
            const initial = [
                'FOO=bar',
                'BAZ=qux',
                '',
                '## Dexto env variables',
                'OPENAI_API_KEY=oldKey',
                'ANTHROPIC_API_KEY=oldAnth',
                '',
                'OTHER=123',
                '',
            ].join('\n');
            await fs.writeFile(path.join(tempDir, '.env'), initial, 'utf8');

            const envFilePath = path.join(tempDir, '.env');
            await updateEnvFileWithLLMKeys(envFilePath, 'anthropic', 'newAnthKey');
            const result = await fs.readFile(path.join(tempDir, '.env'), 'utf8');

            const expected = [
                'FOO=bar',
                'BAZ=qux',
                '',
                'OTHER=123',
                '',
                '## Dexto env variables',
                'OPENAI_API_KEY=oldKey',
                'ANTHROPIC_API_KEY=newAnthKey',
                'GOOGLE_GENERATIVE_AI_API_KEY=',
                'GROQ_API_KEY=',
                'DEXTO_LOG_LEVEL=info',
                '',
            ].join('\n');
            expect(result).toBe(expected);
        });

        it('preserves existing keys in non-Dexto section when updating', async () => {
            const initial = ['OPENAI_API_KEY=foo', 'OTHER=1', ''].join('\n');
            await fs.writeFile(path.join(tempDir, '.env'), initial, 'utf8');

            const envFilePath = path.join(tempDir, '.env');
            await updateEnvFileWithLLMKeys(envFilePath, 'google', 'gkey');
            const result = await fs.readFile(path.join(tempDir, '.env'), 'utf8');
            const expected = [
                'OPENAI_API_KEY=foo',
                'OTHER=1',
                '',
                '## Dexto env variables',
                'ANTHROPIC_API_KEY=',
                'GOOGLE_GENERATIVE_AI_API_KEY=gkey',
                'GROQ_API_KEY=',
                'DEXTO_LOG_LEVEL=info',
                '',
            ].join('\n');
            expect(result).toBe(expected);
        });

        it('adds empty entries for keys not passed and not originally present', async () => {
            // No initial .env file, no keys passed
            const envFilePath = path.join(tempDir, '.env');
            await updateEnvFileWithLLMKeys(envFilePath);
            const result = await fs.readFile(path.join(tempDir, '.env'), 'utf8');
            const expected = [
                '',
                '## Dexto env variables',
                'OPENAI_API_KEY=',
                'ANTHROPIC_API_KEY=',
                'GOOGLE_GENERATIVE_AI_API_KEY=',
                'GROQ_API_KEY=',
                'DEXTO_LOG_LEVEL=info',
                '',
            ].join('\n');
            expect(result).toBe(expected);
        });

        it('updates specific provider key while preserving others', async () => {
            const initial = ['OPENAI_API_KEY=foo', 'OTHER=1', ''].join('\n');
            await fs.writeFile(path.join(tempDir, '.env'), initial, 'utf8');

            const envFilePath = path.join(tempDir, '.env');
            await updateEnvFileWithLLMKeys(envFilePath, 'openai', 'bar');
            const result = await fs.readFile(path.join(tempDir, '.env'), 'utf8');
            const expected = [
                'OPENAI_API_KEY=foo',
                'OTHER=1',
                '',
                '## Dexto env variables',
                'OPENAI_API_KEY=bar',
                'ANTHROPIC_API_KEY=',
                'GOOGLE_GENERATIVE_AI_API_KEY=',
                'GROQ_API_KEY=',
                'DEXTO_LOG_LEVEL=info',
                '',
            ].join('\n');
            expect(result).toBe(expected);
        });

        it('handles multiple providers correctly', async () => {
            const envFilePath = path.join(tempDir, '.env');

            // First add openai key
            await updateEnvFileWithLLMKeys(envFilePath, 'openai', 'openai-key');

            // Then add anthropic key
            await updateEnvFileWithLLMKeys(envFilePath, 'anthropic', 'anthropic-key');

            const result = await fs.readFile(path.join(tempDir, '.env'), 'utf8');
            const expected = [
                '',
                '## Dexto env variables',
                'OPENAI_API_KEY=openai-key',
                'ANTHROPIC_API_KEY=anthropic-key',
                'GOOGLE_GENERATIVE_AI_API_KEY=',
                'GROQ_API_KEY=',
                'DEXTO_LOG_LEVEL=info',
                '',
            ].join('\n');
            expect(result).toBe(expected);
        });
    });
});
