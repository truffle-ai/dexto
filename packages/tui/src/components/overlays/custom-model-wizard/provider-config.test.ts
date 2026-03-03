import { describe, expect, it, vi } from 'vitest';

vi.mock('@dexto/agent-management', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@dexto/agent-management')>();
    return {
        ...actual,
        isDextoAuthEnabled: vi.fn(),
    };
});

import { CUSTOM_MODEL_PROVIDERS, isDextoAuthEnabled } from '@dexto/agent-management';
import { getAvailableProviders, getProviderByMenuIndex } from './provider-config.js';

const mockIsDextoAuthEnabled = vi.mocked(isDextoAuthEnabled);

describe('custom-model-wizard provider ordering', () => {
    it('puts dexto-nova first when enabled', () => {
        mockIsDextoAuthEnabled.mockReturnValue(true);

        const expected = [
            'dexto-nova',
            ...CUSTOM_MODEL_PROVIDERS.filter((p) => p !== 'dexto-nova'),
        ];
        expect(getAvailableProviders()).toEqual(expected);
        expect(getProviderByMenuIndex(0)).toBe('dexto-nova');
        expect(getProviderByMenuIndex(2)).toBe(expected[2]);
    });

    it('hides dexto-nova when disabled', () => {
        mockIsDextoAuthEnabled.mockReturnValue(false);

        const expected = CUSTOM_MODEL_PROVIDERS.filter((p) => p !== 'dexto-nova');
        expect(getAvailableProviders()).toEqual(expected);
        expect(getProviderByMenuIndex(0)).toBe(expected[0]);
        expect(getProviderByMenuIndex(999)).toBeUndefined();
    });
});
