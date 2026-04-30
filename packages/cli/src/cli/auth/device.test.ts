import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    startDeviceCodeLogin: vi.fn(),
    pollDeviceCodeLogin: vi.fn(),
    getDextoApiClient: vi.fn(),
    constructedWith: [] as unknown[],
}));

vi.mock('./api-client.js', () => ({
    DextoApiClient: class MockDextoApiClient {
        constructor(
            _baseUrl?:
                | string
                | { gatewayBaseUrl?: string | undefined; platformBaseUrl?: string | undefined }
        ) {
            mocked.constructedWith.push(_baseUrl);
        }

        startDeviceCodeLogin(client: string, options?: { signal?: AbortSignal | undefined }) {
            return mocked.startDeviceCodeLogin(client, options);
        }

        pollDeviceCodeLogin(deviceCode: string, options?: { signal?: AbortSignal | undefined }) {
            return mocked.pollDeviceCodeLogin(deviceCode, options);
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
        mocked.getDextoApiClient.mockReset();
        mocked.constructedWith.length = 0;
        mocked.getDextoApiClient.mockImplementation(() => ({
            startDeviceCodeLogin: mocked.startDeviceCodeLogin,
            pollDeviceCodeLogin: mocked.pollDeviceCodeLogin,
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
                status: 'approved',
                apiKey: {
                    id: 'key-id',
                    keyDisplay: 'dxt_abc...',
                    name: 'Dexto CLI Key',
                    scopes: ['gateway:use'],
                    status: 'active',
                    fullKey: 'dxt_full_key',
                },
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
        expect(result).toEqual({
            dextoApiKey: 'dxt_full_key',
            dextoKeyDisplay: 'dxt_abc...',
            dextoKeyId: 'key-id',
        });
    });

    it('uses single apiUrl constructor path when apiUrl override is provided', async () => {
        mocked.startDeviceCodeLogin.mockResolvedValue({
            deviceCode: 'device-code',
            userCode: 'ABCD-EFGH',
            verificationUrl: 'https://app.dexto.ai/device',
            verificationUrlComplete: 'https://app.dexto.ai/device?user_code=ABCD-EFGH',
            expiresIn: 300,
            interval: 1,
        });

        mocked.pollDeviceCodeLogin.mockResolvedValue({
            status: 'approved',
            apiKey: {
                id: 'key-id',
                keyDisplay: 'dxt_abc...',
                name: 'Dexto CLI Key',
                scopes: ['gateway:use'],
                status: 'active',
                fullKey: 'dxt_full_key',
            },
        });

        const loginPromise = performDeviceCodeLogin({
            apiUrl: 'http://gateway.local',
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await loginPromise;

        expect(mocked.constructedWith).toEqual(['http://gateway.local']);
        expect(mocked.getDextoApiClient).not.toHaveBeenCalled();
    });
});
