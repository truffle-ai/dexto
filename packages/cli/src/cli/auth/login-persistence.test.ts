import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadAuthMock, storeAuthMock, ensureDextoApiKeyForAuthTokenMock } = vi.hoisted(() => ({
    loadAuthMock: vi.fn(),
    storeAuthMock: vi.fn(),
    ensureDextoApiKeyForAuthTokenMock: vi.fn(),
}));

vi.mock('./service.js', () => ({
    loadAuth: loadAuthMock,
    storeAuth: storeAuthMock,
}));

vi.mock('./dexto-api-key.js', () => ({
    ensureDextoApiKeyForAuthToken: ensureDextoApiKeyForAuthTokenMock,
}));

import { persistDeviceApiKeyLoginResult, persistOAuthLoginResult } from './login-persistence.js';

describe('persistOAuthLoginResult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureDextoApiKeyForAuthTokenMock.mockResolvedValue({
            dextoApiKey: 'dxt_new_key',
            keyId: 'key-new',
        });
    });

    it('preserves an existing provisioned gateway key for the same user', async () => {
        loadAuthMock.mockResolvedValue({
            token: 'old-token',
            refreshToken: 'old-refresh',
            userId: 'user-123',
            email: 'rahul@trytruffle.ai',
            createdAt: 1,
            expiresAt: 2,
            dextoApiKey: 'dxt_existing_key',
            dextoKeyId: 'key-existing',
            dextoApiKeySource: 'provisioned',
            dextoPlatformUrl: 'https://app.dexto.ai',
        });

        await persistOAuthLoginResult({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresIn: 3600,
            user: {
                id: 'user-123',
                email: 'rahul@trytruffle.ai',
            },
        });

        expect(storeAuthMock).toHaveBeenCalledWith(
            expect.objectContaining({
                token: 'new-access-token',
                refreshToken: 'new-refresh-token',
                userId: 'user-123',
                email: 'rahul@trytruffle.ai',
                dextoApiKey: 'dxt_existing_key',
                dextoKeyId: 'key-existing',
                dextoApiKeySource: 'provisioned',
                dextoPlatformUrl: 'https://app.dexto.ai',
                createdAt: expect.any(Number),
                expiresAt: expect.any(Number),
            })
        );
        expect(ensureDextoApiKeyForAuthTokenMock).toHaveBeenCalledWith('new-access-token', {
            onStatus: undefined,
        });
    });

    it('does not preserve a provisioned gateway key when the login is for a different user', async () => {
        loadAuthMock.mockResolvedValue({
            token: 'old-token',
            refreshToken: 'old-refresh',
            userId: 'user-123',
            email: 'rahul@trytruffle.ai',
            createdAt: 1,
            expiresAt: 2,
            dextoApiKey: 'dxt_existing_key',
            dextoKeyId: 'key-existing',
            dextoApiKeySource: 'provisioned',
        });

        await persistOAuthLoginResult({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresIn: 3600,
            user: {
                id: 'user-999',
                email: 'other@trytruffle.ai',
            },
        });

        const storedAuth = storeAuthMock.mock.calls[0]?.[0];
        expect(storedAuth).toBeDefined();
        expect(storedAuth?.dextoApiKey).toBeUndefined();
        expect(storedAuth?.dextoKeyId).toBeUndefined();
        expect(storedAuth?.dextoApiKeySource).toBeUndefined();
    });

    it('preserves legacy provisioned gateway keys with a key id even when the source marker is missing', async () => {
        loadAuthMock.mockResolvedValue({
            token: 'old-token',
            refreshToken: 'old-refresh',
            userId: 'user-123',
            email: 'rahul@trytruffle.ai',
            createdAt: 1,
            expiresAt: 2,
            dextoApiKey: 'dxt_existing_key',
            dextoKeyId: 'key-existing',
        });

        await persistOAuthLoginResult({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresIn: 3600,
            user: {
                id: 'user-123',
                email: 'rahul@trytruffle.ai',
            },
        });

        expect(storeAuthMock).toHaveBeenCalledWith(
            expect.objectContaining({
                token: 'new-access-token',
                refreshToken: 'new-refresh-token',
                userId: 'user-123',
                email: 'rahul@trytruffle.ai',
                dextoApiKey: 'dxt_existing_key',
                dextoKeyId: 'key-existing',
                dextoApiKeySource: 'provisioned',
            })
        );
    });

    it('keeps preserved managed-key metadata when ensure returns null', async () => {
        loadAuthMock.mockResolvedValue({
            token: 'old-token',
            refreshToken: 'old-refresh',
            userId: 'user-123',
            email: 'rahul@trytruffle.ai',
            createdAt: 1,
            expiresAt: 2,
            dextoApiKey: 'dxt_existing_key',
            dextoKeyId: 'key-existing',
            dextoApiKeySource: 'provisioned',
        });
        ensureDextoApiKeyForAuthTokenMock.mockResolvedValue(null);

        const result = await persistOAuthLoginResult({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresIn: 3600,
            user: {
                id: 'user-123',
                email: 'rahul@trytruffle.ai',
            },
        });

        expect(result).toEqual({
            email: 'rahul@trytruffle.ai',
            userId: 'user-123',
            keyId: 'key-existing',
            hasDextoApiKey: true,
        });
    });

    it('does not preserve user-supplied gateway keys across OAuth login', async () => {
        loadAuthMock.mockResolvedValue({
            userId: 'user-123',
            email: 'rahul@trytruffle.ai',
            createdAt: 1,
            dextoApiKey: 'dxt_user_key',
            dextoKeyId: 'key-user',
            dextoApiKeySource: 'user-supplied',
        });

        await persistOAuthLoginResult({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresIn: 3600,
            user: {
                id: 'user-123',
                email: 'rahul@trytruffle.ai',
            },
        });

        const storedAuth = storeAuthMock.mock.calls[0]?.[0];
        expect(storedAuth).toBeDefined();
        expect(storedAuth?.dextoApiKey).toBeUndefined();
        expect(storedAuth?.dextoKeyId).toBeUndefined();
        expect(storedAuth?.dextoApiKeySource).toBeUndefined();
    });
    it('does not send a saved custom-origin key through a different OAuth platform', async () => {
        loadAuthMock.mockResolvedValue({
            userId: 'user-123',
            createdAt: 1,
            dextoApiKey: 'custom-key',
            dextoApiKeySource: 'provisioned',
            dextoPlatformUrl: 'https://preview.example.com',
        });
        await persistOAuthLoginResult({
            accessToken: 'new-access',
            user: { id: 'user-123', email: 'fixture@example.com' },
        });
        expect(storeAuthMock.mock.calls[0]?.[0]?.dextoApiKey).toBeUndefined();
        expect(storeAuthMock.mock.calls[0]?.[0]?.dextoPlatformUrl).toBeUndefined();
    });
});

describe('device login origin', () => {
    it('keeps the one-argument TUI persistence contract using the configured platform', async () => {
        await persistDeviceApiKeyLoginResult({
            dextoApiKey: 'fixture',
            dextoKeyId: 'key',
            dextoKeyDisplay: 'display',
        });
        expect(storeAuthMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ dextoPlatformUrl: 'https://app.dexto.ai' })
        );
    });
    it('binds the saved credential to the effective custom platform origin', async () => {
        await persistDeviceApiKeyLoginResult(
            { dextoApiKey: 'fixture', dextoKeyId: 'key', dextoKeyDisplay: 'display' },
            'http://localhost:8787'
        );
        expect(storeAuthMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                dextoApiKey: 'fixture',
                dextoPlatformUrl: 'http://localhost:8787',
            })
        );
    });
});
