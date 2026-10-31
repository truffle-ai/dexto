import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { writeLogin } from '../auth/dexto-accounts.js';
import { canUseDextoProvider, isDextoAuthenticated } from './dexto-auth.js';

vi.mock('@dexto/core', async () => {
    const actual = await vi.importActual<typeof import('@dexto/core')>('@dexto/core');
    return { ...actual, getDextoGlobalPath: vi.fn() };
});

describe('dexto auth utils', () => {
    let tempDir: string;

    beforeEach(async () => {
        delete process.env.DEXTO_API_KEY;
        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'dexto-auth-test-'));
        const core = await import('@dexto/core');
        vi.mocked(core.getDextoGlobalPath).mockImplementation((type: string) =>
            path.join(tempDir, type)
        );
    });

    afterEach(() => {
        delete process.env.DEXTO_API_KEY;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const login = {
        kind: 'oauth' as const,
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: 'https://app.dexto.ai',
        apiBaseUrl: 'https://api.dexto.ai',
        resource: 'https://app.dexto.ai/mcp',
        tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        scopes: ['cloud:read'],
        savedAt: '2026-10-31T00:00:00.000Z',
        signedInAs: null,
        cloudProject: { id: 'prj_main', name: 'Main' },
    };

    it('is signed out with no sign-in and no DEXTO_API_KEY', async () => {
        expect(await isDextoAuthenticated()).toBe(false);
        expect(await canUseDextoProvider()).toBe(false);
    });

    it('is signed in, but cannot use Dexto models until the sign-in may spend', async () => {
        await writeLogin(path.join(tempDir, 'accounts'), 'default', login);

        expect(await isDextoAuthenticated()).toBe(true);
        expect(await canUseDextoProvider()).toBe(false);

        await writeLogin(path.join(tempDir, 'accounts'), 'default', {
            ...login,
            scopes: ['cloud:read', 'cloud:write'],
        });
        expect(await canUseDextoProvider()).toBe(true);
    });

    it('can use Dexto models with DEXTO_API_KEY', async () => {
        process.env.DEXTO_API_KEY = 'dxt_env';

        expect(await isDextoAuthenticated()).toBe(true);
        expect(await canUseDextoProvider()).toBe(true);
    });
});
