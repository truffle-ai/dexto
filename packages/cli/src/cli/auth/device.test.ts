import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    startDeviceCodeLogin: vi.fn(),
    pollDeviceCodeLogin: vi.fn(),
    fetchSupabaseUser: vi.fn(),
    getDextoApiClient: vi.fn(),
}));

vi.mock('./api-client.js', () => ({
    DextoApiClient: class MockDextoApiClient {
        constructor(
            _baseUrl?:
                | string
                | { gatewayBaseUrl?: string | undefined; platformBaseUrl?: string | undefined }
        ) {}

        startDeviceCodeLogin(client: string, options?: { signal?: AbortSignal | undefined }) {
            return mocked.startDeviceCodeLogin(client, options);
        }

        pollDeviceCodeLogin(deviceCode: string, options?: { signal?: AbortSignal | undefined }) {
            return mocked.pollDeviceCodeLogin(deviceCode, options);
        }

        fetchSupabaseUser(accessToken: string, options?: { signal?: AbortSignal | undefined }) {
            return mocked.fetchSupabaseUser(accessToken, options);
        }
    },
    getDextoApiClient: mocked.getDextoApiClient,
}));

import { performDeviceCodeLogin } from './device.js';

describe('performDeviceCodeLogin', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocked.startDeviceCodeLogin.mockReset();
        mocked.pollDeviceCodeLogin.mockReset();
        mocked.fetchSupabaseUser.mockReset();
        mocked.getDextoApiClient.mockReset();
        mocked.getDextoApiClient.mockImplementation(() => ({
            startDeviceCodeLogin: mocked.startDeviceCodeLogin,
            pollDeviceCodeLogin: mocked.pollDeviceCodeLogin,
            fetchSupabaseUser: mocked.fetchSupabaseUser,
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('retries transient poll failures until device login succeeds', async () => {
        mocked.startDeviceCodeLogin.mockResolvedValue({
            deviceCode: 'device-code',
            userCode: 'ABCD-EFGH',
            verificationUrl: 'https://app.dexto.ai/device',
            verificationUrlComplete: 'https://app.dexto.ai/device?user_code=ABCD-EFGH',
            expiresIn: 300,
            interval: 1,
        });

        mocked.pollDeviceCodeLogin
            .mockResolvedValueOnce({ status: 'transientError' })
            .mockResolvedValueOnce({
                status: 'success',
                token: {
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                    expiresIn: 3600,
                },
            });

        mocked.fetchSupabaseUser.mockResolvedValue({
            id: 'user-id',
            email: 'user@example.com',
            name: 'User Example',
        });

        const onPrompt = vi.fn();

        const loginPromise = performDeviceCodeLogin({
            onPrompt,
        });

        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(3_000);

        const result = await loginPromise;

        expect(onPrompt).toHaveBeenCalledTimes(1);
        expect(mocked.pollDeviceCodeLogin).toHaveBeenCalledTimes(2);
        expect(mocked.fetchSupabaseUser).toHaveBeenCalledWith('access-token', expect.anything());
        expect(result.accessToken).toBe('access-token');
        expect(result.refreshToken).toBe('refresh-token');
        expect(result.user?.email).toBe('user@example.com');
    });
});
