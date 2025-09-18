import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import type { MockInstance } from 'vitest';

describe('api-key-store', () => {
    const ORIGINAL_ENV = { ...process.env };
    let tempDir: string;
    let tempEnvPath: string;
    let apiKeyStore: typeof import('./api-key-store.js');
    let pathSpy: MockInstance;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Create a temp dir and point getDextoEnvPath to a file within it
        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'apikey-store-'));
        tempEnvPath = path.join(tempDir, '.env');

        const pathUtils = await import('@dexto/core');
        pathSpy = vi.spyOn(pathUtils, 'getDextoEnvPath').mockReturnValue(tempEnvPath);

        // Import module under test after mocks are set up
        apiKeyStore = await import('./api-key-store.js');

        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_KEY;
    });

    afterEach(async () => {
        // restore env
        process.env = { ...ORIGINAL_ENV };
        if (pathSpy) pathSpy.mockRestore();
        // cleanup temp dir
        if (fs.existsSync(tempDir)) {
            await fsp.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('saves provider API key to mocked .env path and updates process.env', async () => {
        const { saveProviderApiKey } = apiKeyStore;
        const key = 'sk-test-key-123';

        const meta = await saveProviderApiKey('openai', key, '/unused');
        expect(meta.envVar).toBe('OPENAI_API_KEY');
        expect(meta.targetEnvPath).toBe(tempEnvPath);

        const content = await fsp.readFile(tempEnvPath, 'utf8');
        expect(content).toContain('OPENAI_API_KEY=sk-test-key-123');
        expect(process.env.OPENAI_API_KEY).toBe(key);
    });

    it('reports key status correctly before and after save', async () => {
        const { getProviderKeyStatus, saveProviderApiKey, listProviderKeyStatus } = apiKeyStore;

        // Before
        const before = getProviderKeyStatus('openai');
        expect(before.hasApiKey).toBe(false);
        expect(before.envVar).toBe('OPENAI_API_KEY');

        // After
        await saveProviderApiKey('openai', 'sk-new');
        const after = getProviderKeyStatus('openai');
        expect(after.hasApiKey).toBe(true);

        const map = listProviderKeyStatus();
        const openaiStatus = map['openai'];
        expect(openaiStatus).toBeDefined();
        expect(openaiStatus!.envVar).toBe('OPENAI_API_KEY');
        expect(openaiStatus!.hasApiKey).toBe(true);
    });

    it('throws for missing inputs', async () => {
        const { saveProviderApiKey } = apiKeyStore;
        // @ts-expect-error deliberate invalid
        await expect(saveProviderApiKey(undefined, 'abc')).rejects.toThrow();
        await expect(saveProviderApiKey('openai', '')).rejects.toThrow();
    });
});
