import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

describe('core/utils/api-key-store', () => {
    const ORIGINAL_ENV = { ...process.env };
    let tempDir: string;
    let tempEnvPath: string;
    let apiKeyStore: typeof import('./api-key-store.js');
    let pathUtils: typeof import('./path.js');
    let pathSpy: MockInstance;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'apikey-store-'));
        tempEnvPath = path.join(tempDir, '.env');

        pathUtils = await import('./path.js');
        pathSpy = vi.spyOn(pathUtils, 'getDextoEnvPath').mockReturnValue(tempEnvPath);

        apiKeyStore = await import('./api-key-store.js');

        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_KEY;
    });

    afterEach(async () => {
        process.env = { ...ORIGINAL_ENV };
        pathSpy?.mockRestore();
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

        const before = getProviderKeyStatus('openai');
        expect(before.hasApiKey).toBe(false);
        expect(before.envVar).toBe('OPENAI_API_KEY');

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
