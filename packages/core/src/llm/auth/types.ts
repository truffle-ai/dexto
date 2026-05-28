import type { LLMProvider } from '@dexto/llm';

export type LlmRuntimeAuthOverrides = {
    apiKey?: string | undefined;
    baseURL?: string | undefined;
    headers?: Record<string, string> | undefined;
    fetch?: typeof fetch | undefined;
    auth?: LlmRuntimeAuthInfo | undefined;
};

export type LlmRuntimeAuthInfo = {
    source: 'profile';
    profileId: string;
    providerId: string;
    methodId: string;
    credentialType: string;
};

export type ResolveLlmRuntimeAuthInput = {
    provider: LLMProvider;
    model: string;
    apiKey?: string | undefined;
    baseURL?: string | undefined;
};

export interface LlmAuthResolver {
    resolveRuntimeAuth(input: ResolveLlmRuntimeAuthInput): LlmRuntimeAuthOverrides | null;
}
