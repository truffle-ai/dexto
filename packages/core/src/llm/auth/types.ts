import type { LLMProvider } from '../types.js';

export type LlmRuntimeAuthOverrides = {
    /**
     * Credential value to give the SDK client constructor.
     *
     * - For API key methods: the actual API key.
     * - For OAuth methods: typically a non-empty dummy value, while `fetch` injects
     *   the real access token per request (and can refresh on demand).
     */
    apiKey?: string | undefined;
    /** Optional base URL override used at runtime (not exposed in config schemas). */
    baseURL?: string | undefined;
    /** Extra headers to merge into requests. */
    headers?: Record<string, string> | undefined;
    /**
     * Optional fetch wrapper to implement auth-dependent behavior:
     * - inject authorization headers
     * - refresh OAuth tokens
     * - rewrite request URLs when required (e.g., Codex)
     */
    fetch?: typeof fetch | undefined;
};

export type ResolveLlmRuntimeAuthInput = {
    provider: LLMProvider;
    model: string;
};

export interface LlmAuthResolver {
    resolveRuntimeAuth(input: ResolveLlmRuntimeAuthInput): LlmRuntimeAuthOverrides | null;
}
