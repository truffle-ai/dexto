import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { canUseDextoProvider, getDextoApiKeyFromAuth, isDextoAuthenticated } from './dexto-auth.js';

vi.mock('@dexto/core', async () => {
    const actual = await vi.importActual<typeof import('@dexto/core')>('@dexto/core');
    return {
        ...actual,
        getDextoGlobalPath: vi.fn(),
    };
});

describe('dexto auth utils', () => {
    let tempDir: string;
    let authPath: string;
    let mockGetDextoGlobalPath: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        delete process.env.DEXTO_API_KEY;

        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'dexto-auth-test-'));
        authPath = path.join(tempDir, 'auth.json');

        const core = await import('@dexto/core');
        mockGetDextoGlobalPath = vi.mocked(core.getDextoGlobalPath);
        mockGetDextoGlobalPath.mockImplementation((_type: string, filename?: string) => {
            return filename ? path.join(tempDir, filename) : tempDir;
        });
    });

    afterEach(() => {
        delete process.env.DEXTO_API_KEY;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('treats expired token with refresh token and dexto API key as authenticated', async () => {
        fs.writeFileSync(
            authPath,
            JSON.stringify({
                token: 'expired-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() - 60_000,
                createdAt: Date.now() - 120_000,
                dextoApiKey: 'dxt_live_key',
            })
        );

        await expect(isDextoAuthenticated()).resolves.toBe(true);
        await expect(canUseDextoProvider()).resolves.toBe(true);
        await expect(getDextoApiKeyFromAuth()).resolves.toBe('dxt_live_key');
    });

    it('treats api-key-only auth as usable', async () => {
        fs.writeFileSync(
            authPath,
            JSON.stringify({
                createdAt: Date.now(),
                dextoApiKey: 'dxt_live_key',
                dextoApiKeySource: 'user-supplied',
            })
        );

        await expect(isDextoAuthenticated()).resolves.toBe(true);
        await expect(canUseDextoProvider()).resolves.toBe(true);
    });

    it('rejects expired token auth with no refresh token or API key', async () => {
        fs.writeFileSync(
            authPath,
            JSON.stringify({
                token: 'expired-token',
                expiresAt: Date.now() - 60_000,
                createdAt: Date.now() - 120_000,
            })
        );

        await expect(isDextoAuthenticated()).resolves.toBe(false);
        await expect(canUseDextoProvider()).resolves.toBe(false);
        await expect(getDextoApiKeyFromAuth()).resolves.toBeNull();
    });
});
