import { describe, expect, it, vi } from 'vitest';
import type { TuiAgentBackend } from '../agent-backend.js';
import { refreshDextoNovaAuthAfterLogin } from './dexto-auth-refresh.js';

function createConfig(provider: ReturnType<TuiAgentBackend['getCurrentLLMConfig']>['provider']) {
    return {
        provider,
        model: provider === 'dexto-nova' ? 'openai/gpt-5' : 'gpt-5',
        apiKey: 'existing-key',
        maxIterations: 50,
        maxInputTokens: 128000,
    };
}

describe('refreshDextoNovaAuthAfterLogin', () => {
    it('does nothing when neither the global nor session config uses dexto-nova', async () => {
        const getCurrentLLMConfig = vi
            .fn<TuiAgentBackend['getCurrentLLMConfig']>()
            .mockImplementation((sessionId?: string) =>
                sessionId ? createConfig('openai') : createConfig('openai')
            );
        const hasSessionLLMOverride = vi
            .fn<TuiAgentBackend['hasSessionLLMOverride']>()
            .mockReturnValue(false);
        const switchLLM = vi
            .fn<TuiAgentBackend['switchLLM']>()
            .mockResolvedValue(
                createConfig('openai') as ReturnType<TuiAgentBackend['getCurrentLLMConfig']>
            );

        const refreshed = await refreshDextoNovaAuthAfterLogin(
            { getCurrentLLMConfig, hasSessionLLMOverride, switchLLM },
            'session-1'
        );

        expect(refreshed).toBe(false);
        expect(switchLLM).not.toHaveBeenCalled();
    });

    it('refreshes the global and active session config when both use dexto-nova', async () => {
        const getCurrentLLMConfig = vi
            .fn<TuiAgentBackend['getCurrentLLMConfig']>()
            .mockImplementation((sessionId?: string) =>
                sessionId ? createConfig('dexto-nova') : createConfig('dexto-nova')
            );
        const hasSessionLLMOverride = vi
            .fn<TuiAgentBackend['hasSessionLLMOverride']>()
            .mockReturnValue(true);
        const switchLLM = vi
            .fn<TuiAgentBackend['switchLLM']>()
            .mockResolvedValue(
                createConfig('dexto-nova') as ReturnType<TuiAgentBackend['getCurrentLLMConfig']>
            );

        const refreshed = await refreshDextoNovaAuthAfterLogin(
            { getCurrentLLMConfig, hasSessionLLMOverride, switchLLM },
            'session-1'
        );

        expect(refreshed).toBe(true);
        expect(switchLLM).toHaveBeenCalledTimes(2);
        expect(switchLLM).toHaveBeenNthCalledWith(1, {
            provider: 'dexto-nova',
            model: 'openai/gpt-5',
            apiKey: '$DEXTO_API_KEY',
        });
        expect(switchLLM).toHaveBeenNthCalledWith(
            2,
            {
                provider: 'dexto-nova',
                model: 'openai/gpt-5',
                apiKey: '$DEXTO_API_KEY',
            },
            'session-1'
        );
    });

    it('refreshes only the global config when the session inherits dexto-nova without an override', async () => {
        const getCurrentLLMConfig = vi
            .fn<TuiAgentBackend['getCurrentLLMConfig']>()
            .mockImplementation((sessionId?: string) =>
                sessionId ? createConfig('dexto-nova') : createConfig('dexto-nova')
            );
        const hasSessionLLMOverride = vi
            .fn<TuiAgentBackend['hasSessionLLMOverride']>()
            .mockReturnValue(false);
        const switchLLM = vi
            .fn<TuiAgentBackend['switchLLM']>()
            .mockResolvedValue(
                createConfig('dexto-nova') as ReturnType<TuiAgentBackend['getCurrentLLMConfig']>
            );

        const refreshed = await refreshDextoNovaAuthAfterLogin(
            { getCurrentLLMConfig, hasSessionLLMOverride, switchLLM },
            'session-1'
        );

        expect(refreshed).toBe(true);
        expect(hasSessionLLMOverride).toHaveBeenCalledWith('session-1');
        expect(switchLLM).toHaveBeenCalledTimes(1);
        expect(switchLLM).toHaveBeenCalledWith({
            provider: 'dexto-nova',
            model: 'openai/gpt-5',
            apiKey: '$DEXTO_API_KEY',
        });
    });

    it('refreshes only the active session when the global config uses another provider', async () => {
        const getCurrentLLMConfig = vi
            .fn<TuiAgentBackend['getCurrentLLMConfig']>()
            .mockImplementation((sessionId?: string) =>
                sessionId ? createConfig('dexto-nova') : createConfig('openai')
            );
        const hasSessionLLMOverride = vi
            .fn<TuiAgentBackend['hasSessionLLMOverride']>()
            .mockReturnValue(true);
        const switchLLM = vi
            .fn<TuiAgentBackend['switchLLM']>()
            .mockResolvedValue(
                createConfig('dexto-nova') as ReturnType<TuiAgentBackend['getCurrentLLMConfig']>
            );

        const refreshed = await refreshDextoNovaAuthAfterLogin(
            { getCurrentLLMConfig, hasSessionLLMOverride, switchLLM },
            'session-1'
        );

        expect(refreshed).toBe(true);
        expect(switchLLM).toHaveBeenCalledTimes(1);
        expect(switchLLM).toHaveBeenCalledWith(
            {
                provider: 'dexto-nova',
                model: 'openai/gpt-5',
                apiKey: '$DEXTO_API_KEY',
            },
            'session-1'
        );
    });

    it('refreshes only the global config when there is no active session id', async () => {
        const getCurrentLLMConfig = vi
            .fn<TuiAgentBackend['getCurrentLLMConfig']>()
            .mockImplementation(() => createConfig('dexto-nova'));
        const hasSessionLLMOverride = vi.fn<TuiAgentBackend['hasSessionLLMOverride']>();
        const switchLLM = vi
            .fn<TuiAgentBackend['switchLLM']>()
            .mockResolvedValue(
                createConfig('dexto-nova') as ReturnType<TuiAgentBackend['getCurrentLLMConfig']>
            );

        const refreshed = await refreshDextoNovaAuthAfterLogin({
            getCurrentLLMConfig,
            hasSessionLLMOverride,
            switchLLM,
        });

        expect(refreshed).toBe(true);
        expect(switchLLM).toHaveBeenCalledTimes(1);
        expect(switchLLM).toHaveBeenCalledWith({
            provider: 'dexto-nova',
            model: 'openai/gpt-5',
            apiKey: '$DEXTO_API_KEY',
        });
        expect(hasSessionLLMOverride).not.toHaveBeenCalled();
    });
});
