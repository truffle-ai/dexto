import * as acp from '@agentclientprotocol/sdk';
import { DextoRuntimeError, LLMErrorCode, type DextoAgent } from '@dexto/core';
import { getReasoningProfile, LLM_PROVIDERS, type LLMProvider } from '@dexto/llm';
import {
    canUseDextoProvider,
    dextoGateway,
    getPrimaryApiKeyEnvVar,
    isDextoAuthEnabled,
    loadModelPickerState,
    recordRecentModel,
    type ModelPickerModel,
} from '@dexto/agent-management';

const MODEL_CONFIG_ID = 'model';
const REASONING_CONFIG_ID = 'reasoning';

/**
 * The session's model and reasoning pickers. The model picker offers the session's model, the
 * person's favorites and recents, then the models their Dexto account serves. The reasoning picker
 * appears when the session's model reasons.
 */
export async function modelConfigOptions(
    agent: DextoAgent,
    sessionId: string
): Promise<acp.SessionConfigOption[]> {
    const current = agent.getCurrentLLMConfig(sessionId);
    const currentModel: ModelPickerModel = {
        provider: current.provider,
        model: current.model,
        ...(current.baseURL ? { baseURL: current.baseURL } : {}),
    };
    const [state, account] = await Promise.all([loadModelPickerState(), accountModels()]);
    const seen = new Set<string>();
    const options: acp.SessionConfigSelectOption[] = [];
    const offer = (model: ModelPickerModel, name: string, description: string) => {
        const value = modelValue(model);
        if (seen.has(value)) return;
        seen.add(value);
        options.push({ value, name, description });
    };
    for (const model of [currentModel, ...state.favorites, ...state.recents]) {
        offer(model, model.model, model.provider);
    }
    for (const { id, name } of account) {
        offer({ provider: 'dexto-nova', model: id }, name, 'Dexto');
    }
    const reasoning = reasoningOption(current);
    return [
        {
            id: MODEL_CONFIG_ID,
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: modelValue(currentModel),
            options,
        },
        ...(reasoning ? [reasoning] : []),
    ];
}

/** Applies a choice from the model or reasoning picker to the session. */
export async function chooseConfigOption(
    agent: DextoAgent,
    sessionId: string,
    configId: string,
    value: unknown
): Promise<void> {
    if (typeof value !== 'string') throw acp.RequestError.invalidParams({ configId });
    if (configId === MODEL_CONFIG_ID) return await chooseModel(agent, sessionId, value);
    if (configId === REASONING_CONFIG_ID) return await chooseReasoning(agent, sessionId, value);
    throw acp.RequestError.invalidParams({ configId });
}

/** The models the Dexto account serves; none when Dexto models are off or signed out. */
async function accountModels(): Promise<readonly dextoGateway.DextoModel[]> {
    if (!isDextoAuthEnabled()) return [];
    try {
        return (await dextoGateway.dextoModels(dextoGateway.defaultDextoGatewayOptions())) ?? [];
    } catch (error) {
        // The picker still offers the person's own models.
        console.error('dexto acp: could not list Dexto models', error);
        return [];
    }
}

function reasoningOption(current: {
    provider: LLMProvider;
    model: string;
    reasoning?: { variant: string } | undefined;
}): acp.SessionConfigOption | null {
    const profile = getReasoningProfile(current.provider, current.model);
    if (!profile.capable) return null;
    const currentValue =
        current.reasoning?.variant ?? profile.defaultVariant ?? profile.variants[0]?.id;
    if (currentValue === undefined) return null;
    return {
        id: REASONING_CONFIG_ID,
        name: 'Reasoning effort',
        category: 'thought_level',
        type: 'select',
        currentValue,
        options: profile.variants.map(({ id, label }) => ({ value: id, name: label })),
    };
}

async function chooseModel(agent: DextoAgent, sessionId: string, value: string): Promise<void> {
    const model = parseModelValue(value);
    // As in the TUI: Dexto models need a sign-in that may spend credits.
    if (model.provider === 'dexto-nova' && !(await canUseDextoProvider())) {
        throw acp.RequestError.authRequired({ provider: model.provider }, DEXTO_SIGN_IN);
    }
    try {
        await agent.switchLLM(
            {
                provider: model.provider,
                model: model.model,
                // No endpoint on the chosen model means the provider's default, not the current one.
                baseURL: model.baseURL ?? null,
            },
            sessionId
        );
    } catch (error) {
        throw keyRequired(error);
    }
    await recordRecentModel(model);
}

async function chooseReasoning(agent: DextoAgent, sessionId: string, value: string): Promise<void> {
    const current = agent.getCurrentLLMConfig(sessionId);
    const profile = getReasoningProfile(current.provider, current.model);
    if (!profile.capable || !profile.variants.some(({ id }) => id === value)) {
        throw acp.RequestError.invalidParams({ value });
    }
    await agent.switchLLM(
        {
            provider: current.provider,
            model: current.model,
            ...(current.baseURL ? { baseURL: current.baseURL } : {}),
            // The model's default is stored as no choice, as in the TUI.
            reasoning: value === profile.defaultVariant ? null : { variant: value },
        },
        sessionId
    );
}

const DEXTO_SIGN_IN =
    'Dexto models need a sign-in that may spend credits. Run dexto login --scope cloud:write, or pick another model.';

/**
 * A model that can't run for want of its provider's key, as ACP's auth_required error saying what
 * to set; any other error unchanged.
 */
export function keyRequired(error: unknown): unknown {
    const provider = providerMissingKey(error);
    if (provider === null) return error;
    return acp.RequestError.authRequired(
        { provider },
        provider === 'dexto-nova'
            ? DEXTO_SIGN_IN
            : `Set ${getPrimaryApiKeyEnvVar(provider)} to use ${provider} models, or pick another model.`
    );
}

/** The provider an error says has no key, or null for any other error. */
function providerMissingKey(error: unknown): LLMProvider | null {
    if (!(error instanceof DextoRuntimeError) || error.code !== LLMErrorCode.API_KEY_MISSING) {
        return null;
    }
    const { context } = error;
    if (typeof context !== 'object' || context === null || !('provider' in context)) return null;
    return LLM_PROVIDERS.find((known) => known === context.provider) ?? null;
}

function modelValue(model: ModelPickerModel): string {
    return JSON.stringify([model.provider, model.model, model.baseURL ?? null]);
}

function parseModelValue(value: string): ModelPickerModel {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw acp.RequestError.invalidParams({ value });
    }
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
        throw acp.RequestError.invalidParams({ value });
    }
    const [name, model, baseURL] = parsed;
    const provider = LLM_PROVIDERS.find((known) => known === name);
    if (provider === undefined) throw acp.RequestError.invalidParams({ value });
    return {
        provider,
        model,
        ...(typeof baseURL === 'string' ? { baseURL } : {}),
    };
}
