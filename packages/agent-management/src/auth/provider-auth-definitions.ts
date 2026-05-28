import { createCodexBaseURL, type LlmRuntimeAuthOverrides, type LLMProvider } from '@dexto/core';

export const AUTH_METHOD_KINDS = ['api_key', 'external_account'] as const;
export type AuthMethodKind = (typeof AUTH_METHOD_KINDS)[number];

export type ExternalAccountCredential = {
    type: 'external_account';
    system: 'codex';
    authMode: 'chatgpt';
    metadata?: Record<string, string> | undefined;
};

export type RuntimeAuthInput = {
    credential: ExternalAccountCredential;
};

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

export type ExternalAccountAuthMethodDefinition = AuthMethodDefinitionBase & {
    kind: 'external_account';
    externalAccount: {
        resolveRuntimeAuth(input: RuntimeAuthInput): LlmRuntimeAuthOverrides;
    };
};

export type AuthMethodDefinition = ApiKeyAuthMethodDefinition | ExternalAccountAuthMethodDefinition;

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
    kind: 'external_account',
    hint: 'Use your ChatGPT account for OpenAI models',
    externalAccount: {
        resolveRuntimeAuth: ({ credential }) => {
            if (credential.system !== 'codex' || credential.authMode !== 'chatgpt') {
                throw new Error('ChatGPT Login requires a Codex ChatGPT external account');
            }

            return {
                baseURL: createCodexBaseURL('chatgpt'),
            };
        },
    },
} as const satisfies ExternalAccountAuthMethodDefinition;

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

export function isExternalAccountAuthMethod(
    method: AuthMethodDefinition
): method is ExternalAccountAuthMethodDefinition {
    return method.kind === 'external_account';
}
