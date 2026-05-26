import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    performDeviceCodeLogin,
    persistDeviceApiKeyLoginResult,
    setTuiRuntimeServices,
} from './index.js';

describe('TUI auth runtime services', () => {
    afterEach(() => {
        setTuiRuntimeServices({});
    });

    it('uses host-provided API-key device login and persistence services', async () => {
        const prompt = vi.fn();
        const perform = vi.fn().mockResolvedValue({
            dextoApiKey: 'dxt_full_key',
            dextoKeyDisplay: 'dxt_abc...',
            dextoKeyId: 'key-id',
        });
        const persist = vi.fn().mockResolvedValue({
            keyId: 'key-id',
            hasDextoApiKey: true,
        });

        setTuiRuntimeServices({
            performDeviceCodeLogin: perform,
            persistDeviceApiKeyLoginResult: persist,
        });

        const loginResult = await performDeviceCodeLogin({
            onPrompt: prompt,
        });
        const persisted = await persistDeviceApiKeyLoginResult(loginResult);

        expect(perform).toHaveBeenCalledWith({ onPrompt: prompt });
        expect(persist).toHaveBeenCalledWith({
            dextoApiKey: 'dxt_full_key',
            dextoKeyDisplay: 'dxt_abc...',
            dextoKeyId: 'key-id',
        });
        expect(persisted).toEqual({
            keyId: 'key-id',
            hasDextoApiKey: true,
        });
    });

    it('fails fast when API-key device login persistence is not provided by the host', async () => {
        await expect(
            persistDeviceApiKeyLoginResult({
                dextoApiKey: 'dxt_full_key',
                dextoKeyDisplay: 'dxt_abc...',
                dextoKeyId: 'key-id',
            })
        ).rejects.toThrow('TUI runtime services missing required method');
    });
});
