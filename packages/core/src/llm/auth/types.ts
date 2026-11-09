import type { LLMProvider } from '@dexto/llm';

export type LlmRuntimeAuthOverrides = {
    apiKey?: string | undefined;
    baseURL?: string | undefined;
    headers?: Record<string, string> | undefined;
    fetch?: typeof fetch | undefined;
    /** Optional host-owned credential provenance and failure classification for each request. */
    requestAuth?: LlmRequestAuth | undefined;
    auth?: LlmRuntimeAuthInfo | undefined;
};

/** Request authentication may replace the API key. The classification body is bounded to 64 KiB. */
export type LlmRequestAuth = {
    fetch: (
        input: RequestInfo | URL,
        init?: RequestInit
    ) => Promise<{ response: Response; provenance: unknown }>;
    isRetryableResponse: (input: {
        response: Response;
        provenance: unknown;
        signal?: AbortSignal | null;
    }) => Promise<boolean>;
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
