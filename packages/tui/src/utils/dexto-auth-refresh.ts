import type { TuiAgentBackend } from '../agent-backend.js';

const DEXTO_API_KEY_ENV_REF = '$DEXTO_API_KEY';

function buildDextoNovaRefreshUpdate(model: string) {
    return {
        provider: 'dexto-nova' as const,
        model,
        apiKey: DEXTO_API_KEY_ENV_REF,
    };
}

export async function refreshDextoNovaAuthAfterLogin(
    agent: Pick<TuiAgentBackend, 'getCurrentLLMConfig' | 'hasSessionLLMOverride' | 'switchLLM'>,
    sessionId?: string
): Promise<boolean> {
    let refreshed = false;

    const globalConfig = agent.getCurrentLLMConfig();
    if (globalConfig.provider === 'dexto-nova') {
        await agent.switchLLM(buildDextoNovaRefreshUpdate(globalConfig.model));
        refreshed = true;
    }

    if (!sessionId) {
        return refreshed;
    }

    if (!agent.hasSessionLLMOverride(sessionId)) {
        return refreshed;
    }

    const sessionConfig = agent.getCurrentLLMConfig(sessionId);
    if (sessionConfig.provider !== 'dexto-nova') {
        return refreshed;
    }

    await agent.switchLLM(buildDextoNovaRefreshUpdate(sessionConfig.model), sessionId);
    return true;
}
