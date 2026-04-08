import { createCodexBaseURL } from '@dexto/core';
import type { LlmAuthCredential, LlmAuthProfile } from './llm-profiles.js';
import {
    refreshMiniMaxPortalOauth,
    resolveMiniMaxPortalRuntimeAuth,
    startMiniMaxPortalOauth,
    type MiniMaxRegion,
} from './oauth/minimax-portal.js';

export const AUTH_METHOD_KINDS = [
    'api_key',
    'token',
    'oauth',
    'external_account',
    'guidance',
] as const;
export type AuthMethodKind = (typeof AUTH_METHOD_KINDS)[number];

type OAuthCredential = Extract<LlmAuthCredential, { type: 'oauth' }>;
type ExternalAccountCredential = Extract<LlmAuthCredential, { type: 'external_account' }>;

export type OAuthHeaderKind = 'authorization_bearer' | 'x_api_key';

export type OAuthRuntimeAuthProjection = {
    headerKind: OAuthHeaderKind;
    baseURL?: string | undefined;
    extraHeaders?: Record<string, string> | undefined;
};

export type StartedOAuthFlow = {
    verificationUrl: string;
    userCode: string;
    waitForCompletion(params: { onProgress?: ((message: string) => void) | undefined }): Promise<{
        credential: OAuthCredential;
        notificationMessage?: string | undefined;
    }>;
};

export type OAuthMethodHooks = {
    start(params: { userAgent?: string | undefined }): Promise<StartedOAuthFlow>;
    refresh(params: {
        profile: LlmAuthProfile;
        credential: OAuthCredential;
    }): Promise<OAuthCredential>;
    resolveRuntimeAuth(params: {
        profile: LlmAuthProfile;
        credential: OAuthCredential;
    }): OAuthRuntimeAuthProjection;
};

export type ExternalAccountRuntimeAuthProjection = {
    apiKey?: string | undefined;
    baseURL?: string | undefined;
    extraHeaders?: Record<string, string> | undefined;
};

export type ExternalAccountMethodHooks = {
    resolveRuntimeAuth(params: {
        profile: LlmAuthProfile;
        credential: ExternalAccountCredential;
    }): ExternalAccountRuntimeAuthProjection;
};

type AuthMethodDefinitionBase = {
    id: string;
    label: string;
    kind: AuthMethodKind;
    hint?: string | undefined;
};

export type ApiKeyAuthMethodDefinition = AuthMethodDefinitionBase & {
    kind: 'api_key';
};

export type TokenAuthMethodDefinition = AuthMethodDefinitionBase & {
    kind: 'token';
};

export type GuidanceAuthMethodDefinition = AuthMethodDefinitionBase & {
    kind: 'guidance';
};

export type ExternalAccountAuthMethodDefinition = AuthMethodDefinitionBase & {
    kind: 'external_account';
    externalAccount: ExternalAccountMethodHooks;
};

export type OAuthAuthMethodDefinition = AuthMethodDefinitionBase & {
    kind: 'oauth';
    oauth: OAuthMethodHooks;
};

export type AuthMethodDefinition =
    | ApiKeyAuthMethodDefinition
    | TokenAuthMethodDefinition
    | ExternalAccountAuthMethodDefinition
    | GuidanceAuthMethodDefinition
    | OAuthAuthMethodDefinition;

export type ProviderAuthDefinition = {
    providerId: string;
    label: string;
    modelsDevProviderId?: string | undefined;
    methods: readonly AuthMethodDefinition[];
};

const API_KEY_METHOD = {
    id: 'api_key',
    label: 'API key',
    kind: 'api_key',
} as const satisfies ApiKeyAuthMethodDefinition;

const ANTHROPIC_SETUP_TOKEN_METHOD = {
    id: 'setup_token',
    label: 'Setup token (subscription)',
    kind: 'token',
} as const satisfies TokenAuthMethodDefinition;

function createGuidanceMethod(hint: string): GuidanceAuthMethodDefinition {
    return {
        id: 'guidance',
        label: 'Guided setup',
        kind: 'guidance',
        hint,
    };
}

function createMiniMaxOauthMethod(config: {
    methodId: 'portal_oauth_global' | 'portal_oauth_cn';
    label: string;
    region: MiniMaxRegion;
}): OAuthAuthMethodDefinition {
    return {
        id: config.methodId,
        label: config.label,
        kind: 'oauth',
        oauth: {
            start: async (params) =>
                await startMiniMaxPortalOauth({ ...params, region: config.region }),
            refresh: async (params) =>
                await refreshMiniMaxPortalOauth({ ...params, region: config.region }),
            resolveRuntimeAuth: (params) =>
                resolveMiniMaxPortalRuntimeAuth({ ...params, region: config.region }),
        },
    };
}

function createMiniMaxProviderAuthDefinition(config: {
    providerId: string;
    label: string;
    modelsDevProviderId: string;
    allowGlobalOauth: boolean;
    allowChinaOauth: boolean;
}): ProviderAuthDefinition {
    const methods: AuthMethodDefinition[] = [];

    if (config.allowGlobalOauth) {
        methods.push(
            createMiniMaxOauthMethod({
                methodId: 'portal_oauth_global',
                label: 'MiniMax Portal OAuth (Global)',
                region: 'global',
            })
        );
    }

    if (config.allowChinaOauth) {
        methods.push(
            createMiniMaxOauthMethod({
                methodId: 'portal_oauth_cn',
                label: 'MiniMax Portal OAuth (CN)',
                region: 'cn',
            })
        );
    }

    methods.push(API_KEY_METHOD);

    return {
        providerId: config.providerId,
        label: config.label,
        modelsDevProviderId: config.modelsDevProviderId,
        methods,
    };
}

function createOpenAiChatGptLoginMethod(): ExternalAccountAuthMethodDefinition {
    return {
        id: 'chatgpt_login',
        label: 'ChatGPT Login',
        kind: 'external_account',
        hint: 'Uses your ChatGPT account through Codex',
        externalAccount: {
            resolveRuntimeAuth: ({ credential }) => {
                const authMode =
                    credential.system === 'codex' &&
                    (credential.authMode === 'chatgpt' || credential.authMode === 'apikey')
                        ? credential.authMode
                        : 'auto';

                return {
                    baseURL: createCodexBaseURL(authMode),
                };
            },
        },
    };
}

const API_KEY_ONLY_PROVIDER_SPECS = [
    {
        providerId: 'moonshotai',
        label: 'Moonshot AI (Kimi)',
        modelsDevProviderId: 'moonshotai',
    },
    {
        providerId: 'moonshotai-cn',
        label: 'Moonshot AI (Kimi) (China)',
        modelsDevProviderId: 'moonshotai-cn',
    },
    {
        providerId: 'zhipuai',
        label: 'Zhipu AI (GLM)',
        modelsDevProviderId: 'zhipuai',
    },
    {
        providerId: 'zhipuai-coding-plan',
        label: 'Zhipu AI Coding Plan',
        modelsDevProviderId: 'zhipuai-coding-plan',
    },
    {
        providerId: 'zai',
        label: 'Z.AI',
        modelsDevProviderId: 'zai',
    },
    {
        providerId: 'zai-coding-plan',
        label: 'Z.AI Coding Plan',
        modelsDevProviderId: 'zai-coding-plan',
    },
    {
        providerId: 'kimi-for-coding',
        label: 'Kimi For Coding',
        modelsDevProviderId: 'kimi-for-coding',
    },
    {
        providerId: 'openrouter',
        label: 'OpenRouter',
        modelsDevProviderId: 'openrouter',
    },
] as const satisfies ReadonlyArray<{
    providerId: string;
    label: string;
    modelsDevProviderId: string;
}>;

const GUIDANCE_PROVIDER_SPECS = [
    {
        providerId: 'litellm',
        label: 'LiteLLM',
        modelsDevProviderId: 'litellm',
        hint: 'Set base URL and API key for your LiteLLM proxy',
    },
    {
        providerId: 'amazon-bedrock',
        label: 'Amazon Bedrock',
        modelsDevProviderId: 'amazon-bedrock',
        hint: 'Use AWS credential chain or AWS_BEARER_TOKEN_BEDROCK',
    },
    {
        providerId: 'google-vertex',
        label: 'Google Vertex AI (Gemini)',
        modelsDevProviderId: 'google-vertex',
        hint: 'Use Application Default Credentials (gcloud auth application-default login)',
    },
    {
        providerId: 'google-vertex-anthropic',
        label: 'Google Vertex AI (Claude)',
        modelsDevProviderId: 'google-vertex-anthropic',
        hint: 'Use Application Default Credentials (gcloud auth application-default login)',
    },
] as const satisfies ReadonlyArray<{
    providerId: string;
    label: string;
    modelsDevProviderId: string;
    hint: string;
}>;

export const PROVIDER_AUTH_DEFINITIONS: readonly ProviderAuthDefinition[] = [
    {
        providerId: 'openai',
        label: 'OpenAI',
        modelsDevProviderId: 'openai',
        methods: [createOpenAiChatGptLoginMethod(), API_KEY_METHOD],
    },
    {
        providerId: 'anthropic',
        label: 'Anthropic',
        modelsDevProviderId: 'anthropic',
        methods: [ANTHROPIC_SETUP_TOKEN_METHOD, API_KEY_METHOD],
    },
    createMiniMaxProviderAuthDefinition({
        providerId: 'minimax',
        label: 'MiniMax',
        modelsDevProviderId: 'minimax',
        allowGlobalOauth: true,
        allowChinaOauth: true,
    }),
    createMiniMaxProviderAuthDefinition({
        providerId: 'minimax-cn',
        label: 'MiniMax (CN)',
        modelsDevProviderId: 'minimax-cn',
        allowGlobalOauth: false,
        allowChinaOauth: true,
    }),
    createMiniMaxProviderAuthDefinition({
        providerId: 'minimax-coding-plan',
        label: 'MiniMax Coding Plan',
        modelsDevProviderId: 'minimax-coding-plan',
        allowGlobalOauth: true,
        allowChinaOauth: true,
    }),
    createMiniMaxProviderAuthDefinition({
        providerId: 'minimax-cn-coding-plan',
        label: 'MiniMax Coding Plan (CN)',
        modelsDevProviderId: 'minimax-cn-coding-plan',
        allowGlobalOauth: false,
        allowChinaOauth: true,
    }),
    ...API_KEY_ONLY_PROVIDER_SPECS.map((provider) => ({
        providerId: provider.providerId,
        label: provider.label,
        modelsDevProviderId: provider.modelsDevProviderId,
        methods: [API_KEY_METHOD],
    })),
    ...GUIDANCE_PROVIDER_SPECS.map((provider) => ({
        providerId: provider.providerId,
        label: provider.label,
        modelsDevProviderId: provider.modelsDevProviderId,
        methods: [createGuidanceMethod(provider.hint)],
    })),
];

export function isOauthAuthMethod(
    method: AuthMethodDefinition
): method is OAuthAuthMethodDefinition {
    return method.kind === 'oauth';
}

export function isExternalAccountAuthMethod(
    method: AuthMethodDefinition
): method is ExternalAccountAuthMethodDefinition {
    return method.kind === 'external_account';
}

export function getProviderAuthDefinition(providerId: string): ProviderAuthDefinition | null {
    return PROVIDER_AUTH_DEFINITIONS.find((provider) => provider.providerId === providerId) ?? null;
}

export function getAuthMethodDefinition(
    providerId: string,
    methodId: string
): AuthMethodDefinition | null {
    const provider = getProviderAuthDefinition(providerId);
    if (!provider) return null;
    return provider.methods.find((method) => method.id === methodId) ?? null;
}

export function getAuthMethodDefinitionForProfile(
    profile: Pick<LlmAuthProfile, 'providerId' | 'methodId'>
): AuthMethodDefinition | null {
    return getAuthMethodDefinition(profile.providerId, profile.methodId);
}
