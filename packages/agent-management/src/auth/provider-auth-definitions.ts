import type { LLMProvider } from '@dexto/core';

export const AUTH_METHOD_KINDS = ['api_key', 'oauth'] as const;
export type AuthMethodKind = (typeof AUTH_METHOD_KINDS)[number];

type AuthMethodDefinitionBase = {
    id: string;
    label: string;
    kind: AuthMethodKind;
    hint?: string | undefined;
};

export type ApiKeyAuthMethodDefinition = AuthMethodDefinitionBase & {
    id: 'api_key';
    kind: 'api_key';
};

export type OAuthAuthMethodDefinition = AuthMethodDefinitionBase & {
    kind: 'oauth';
};

export type AuthMethodDefinition = ApiKeyAuthMethodDefinition | OAuthAuthMethodDefinition;

export type ProviderAuthDefinition = {
    providerId: LLMProvider;
    label: string;
    methods: readonly AuthMethodDefinition[];
};

export const OPENAI_API_KEY_AUTH_METHOD = {
    id: 'api_key',
    label: 'API key',
    kind: 'api_key',
} as const satisfies ApiKeyAuthMethodDefinition;

export const OPENAI_CHATGPT_LOGIN_AUTH_METHOD = {
    id: 'chatgpt_login',
    label: 'ChatGPT Login',
    kind: 'oauth',
    hint: 'Use your ChatGPT account for OpenAI models',
} as const satisfies OAuthAuthMethodDefinition;

export const PROVIDER_AUTH_DEFINITIONS = [
    {
        providerId: 'openai',
        label: 'OpenAI',
        methods: [OPENAI_API_KEY_AUTH_METHOD, OPENAI_CHATGPT_LOGIN_AUTH_METHOD],
    },
] as const satisfies readonly ProviderAuthDefinition[];

export function getProviderAuthDefinitions(): readonly ProviderAuthDefinition[] {
    return PROVIDER_AUTH_DEFINITIONS;
}

export function getProviderAuthDefinition(providerId: string): ProviderAuthDefinition | null {
    return PROVIDER_AUTH_DEFINITIONS.find((provider) => provider.providerId === providerId) ?? null;
}

export function getAuthMethodDefinition(
    providerId: string,
    methodId: string
): AuthMethodDefinition | null {
    return (
        getProviderAuthDefinition(providerId)?.methods.find((method) => method.id === methodId) ??
        null
    );
}

export function isOAuthAuthMethod(
    method: AuthMethodDefinition
): method is OAuthAuthMethodDefinition {
    return method.kind === 'oauth';
}
