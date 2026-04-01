import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('./path.js', () => ({
    getDextoGlobalPath: vi.fn(),
}));

describe('resolveApiKeyForProvider', () => {
    let tempDir: string;
    let authPath: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        delete process.env.DEXTO_API_KEY;

        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'dexto-api-key-resolver-'));
        authPath = path.join(tempDir, 'auth.json');

        const pathUtils = await import('./path.js');
        vi.mocked(pathUtils.getDextoGlobalPath).mockImplementation(
            (_type: string, filename?: string) =>
                filename ? path.join(tempDir, filename) : tempDir
        );
    });

    afterEach(() => {
        delete process.env.DEXTO_API_KEY;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('prefers the auth.json Dexto key over a stale env key', async () => {
        process.env.DEXTO_API_KEY = 'stale-env-key';
        fs.writeFileSync(
            authPath,
            JSON.stringify({
                dextoApiKey: 'fresh-auth-key',
            })
        );

        const { resolveApiKeyForProvider } = await import('./api-key-resolver.js');

        expect(resolveApiKeyForProvider('dexto-nova')).toBe('fresh-auth-key');
        expect(process.env.DEXTO_API_KEY).toBe('fresh-auth-key');
    });

    it('falls back to environment variables for non-Dexto providers', async () => {
        process.env.OPENAI_API_KEY = 'openai-key';

        const { resolveApiKeyForProvider } = await import('./api-key-resolver.js');

        expect(resolveApiKeyForProvider('openai')).toBe('openai-key');

        delete process.env.OPENAI_API_KEY;
    });
});
