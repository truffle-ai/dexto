import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleLoginCommand } from './login.js';

const mocked = vi.hoisted(() => ({
    isAuthenticated: vi.fn(),
    performDeviceCodeLogin: vi.fn(),
    persistDeviceApiKeyLoginResult: vi.fn(),
    validateDextoApiKey: vi.fn(),
    constructClient: vi.fn(),
    storeAuth: vi.fn(),
}));

vi.mock('../../auth/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../auth/index.js')>();
    return {
        ...actual,
        isAuthenticated: mocked.isAuthenticated,
        performDeviceCodeLogin: mocked.performDeviceCodeLogin,
        persistDeviceApiKeyLoginResult: mocked.persistDeviceApiKeyLoginResult,
        storeAuth: mocked.storeAuth,
        DextoApiClient: class {
            constructor(options: unknown) {
                mocked.constructClient(options);
            }
            validateDextoApiKey = mocked.validateDextoApiKey;
        },
    };
});

describe('handleLoginCommand', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('throws when --api-key and --token are both provided', async () => {
        await expect(
            handleLoginCommand({
                apiKey: 'dexto_test_key',
                token: 'supabase_test_token',
            })
        ).rejects.toThrow('Cannot use both --api-key and --token. Choose one.');
    });

    it('passes platformUrl to device login for local and preview smoke tests', async () => {
        vi.stubEnv('DEXTO_API_URL', 'https://legacy-gateway.example.com');
        mocked.isAuthenticated.mockResolvedValue(false);
        mocked.performDeviceCodeLogin.mockResolvedValue({
            dextoApiKey: 'dxt_full_key',
            dextoKeyDisplay: 'dxt_abc...',
            dextoKeyId: 'key-id',
        });
        mocked.persistDeviceApiKeyLoginResult.mockResolvedValue({
            keyId: 'key-id',
            hasDextoApiKey: true,
        });

        await handleLoginCommand({
            interactive: false,
            platformUrl: 'http://localhost:8787',
        });

        expect(mocked.performDeviceCodeLogin).toHaveBeenCalledWith(
            expect.objectContaining({
                apiUrl: 'http://localhost:8787',
            })
        );
        expect(mocked.persistDeviceApiKeyLoginResult).toHaveBeenCalledWith(
            {
                dextoApiKey: 'dxt_full_key',
                dextoKeyDisplay: 'dxt_abc...',
                dextoKeyId: 'key-id',
            },
            'http://localhost:8787'
        );
    });
    it('binds an explicitly supplied API key to its requested platform', async () => {
        mocked.isAuthenticated.mockResolvedValue(false);
        mocked.validateDextoApiKey.mockResolvedValue(true);
        await handleLoginCommand({
            apiKey: 'fixture-key',
            platformUrl: 'http://localhost:8787',
            interactive: false,
        });
        expect(mocked.constructClient).toHaveBeenCalledWith('http://localhost:8787');
        expect(mocked.storeAuth).toHaveBeenCalledWith(
            expect.objectContaining({
                dextoApiKey: 'fixture-key',
                dextoPlatformUrl: 'http://localhost:8787',
            })
        );
    });
});
