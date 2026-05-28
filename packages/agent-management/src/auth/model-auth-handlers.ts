import type { LlmAuthResolver } from '@dexto/core';
import {
    createChatGPTRuntimeAuth,
    startChatGPTBrowserLogin,
    type ChatGPTOAuthCredential,
    type ChatGPTRuntimeAuth,
} from './chatgpt-oauth.js';
import {
    getDefaultModelAuthProfile,
    getModelAuthProfileId,
    loadModelAuthProfilesSync,
    upsertModelAuthProfile,
    type ModelAuthProfile,
    type OAuthModelAuthCredential,
} from './model-auth-profiles.js';
import {
    globalPreferencesExist,
    loadGlobalPreferences,
    updateGlobalPreferences,
} from '../preferences/index.js';

export type PendingModelAuthBrowserLogin = {
    label: string;
    authUrl: string;
    waitForProfile(): Promise<ModelAuthProfile>;
    cancel(): Promise<void>;
};

type ModelAuthMethodHandler = {
    providerId: string;
    methodId: string;
    startBrowserLogin?(): Promise<PendingModelAuthBrowserLogin>;
    resolveRuntimeAuth?(
        profile: ModelAuthProfile
    ): ReturnType<LlmAuthResolver['resolveRuntimeAuth']>;
};

function toChatGPTCredential(credential: OAuthModelAuthCredential): ChatGPTOAuthCredential {
    return {
        type: 'oauth',
        issuer: 'https://auth.openai.com',
        refreshToken: credential.refreshToken,
        accessToken: credential.accessToken,
        expiresAt: credential.expiresAt,
        accountId: credential.metadata?.accountId,
    };
}

function fromChatGPTCredential(credential: ChatGPTOAuthCredential): OAuthModelAuthCredential {
    return {
        type: 'oauth',
        issuer: credential.issuer,
        refreshToken: credential.refreshToken,
        accessToken: credential.accessToken,
        expiresAt: credential.expiresAt,
        ...(credential.accountId ? { metadata: { accountId: credential.accountId } } : {}),
    };
}

export async function saveChatGPTLoginModelAuthProfile(
    credential: ChatGPTOAuthCredential
): Promise<ModelAuthProfile> {
    return upsertModelAuthProfile({
        id: getModelAuthProfileId('openai', 'chatgpt_login'),
        providerId: 'openai',
        methodId: 'chatgpt_login',
        label: 'ChatGPT Login',
        credential: fromChatGPTCredential(credential),
    });
}

async function updateChatGPTLoginCredential(credential: ChatGPTOAuthCredential): Promise<void> {
    await saveChatGPTLoginModelAuthProfile(credential);
}

async function startOpenAIChatGPTBrowserLogin(): Promise<PendingModelAuthBrowserLogin> {
    const login = await startChatGPTBrowserLogin();
    return {
        label: 'ChatGPT Login',
        authUrl: login.authUrl,
        waitForProfile: async () =>
            saveChatGPTLoginModelAuthProfile(await login.waitForCredential()),
        cancel: login.cancel,
    };
}

const MODEL_AUTH_METHOD_HANDLERS: readonly ModelAuthMethodHandler[] = [
    {
        providerId: 'openai',
        methodId: 'chatgpt_login',
        startBrowserLogin: startOpenAIChatGPTBrowserLogin,
        resolveRuntimeAuth: (profile) =>
            profile.credential.type === 'oauth'
                ? (createChatGPTRuntimeAuth({
                      credential: toChatGPTCredential(profile.credential),
                      updateCredential: updateChatGPTLoginCredential,
                  }) satisfies ChatGPTRuntimeAuth)
                : null,
    },
];

function getModelAuthMethodHandler(
    providerId: string,
    methodId: string
): ModelAuthMethodHandler | null {
    return (
        MODEL_AUTH_METHOD_HANDLERS.find(
            (handler) => handler.providerId === providerId && handler.methodId === methodId
        ) ?? null
    );
}

export async function startModelAuthBrowserLogin(input: {
    providerId: string;
    methodId: string;
}): Promise<PendingModelAuthBrowserLogin> {
    const handler = getModelAuthMethodHandler(input.providerId, input.methodId);
    if (!handler?.startBrowserLogin) {
        throw new Error(
            `Auth method is not implemented yet: ${input.providerId}/${input.methodId}`
        );
    }

    return handler.startBrowserLogin();
}

export async function markModelAuthProviderConnected(providerId: string): Promise<void> {
    if (!globalPreferencesExist()) {
        return;
    }

    const preferences = await loadGlobalPreferences();
    if (preferences.llm.provider !== providerId) {
        return;
    }

    await updateGlobalPreferences({
        setup: {
            apiKeyPending: false,
        },
    });
}

function resolveRuntimeAuthFromProfile(
    profile: ModelAuthProfile
): ReturnType<LlmAuthResolver['resolveRuntimeAuth']> {
    if (profile.credential.type === 'api_key_env') {
        const apiKey = process.env[profile.credential.envVar]?.trim();
        return apiKey ? { apiKey } : null;
    }

    return (
        getModelAuthMethodHandler(profile.providerId, profile.methodId)?.resolveRuntimeAuth?.(
            profile
        ) ?? null
    );
}

export function createModelAuthResolver(): LlmAuthResolver {
    return {
        resolveRuntimeAuth(input) {
            const profile = getDefaultModelAuthProfile(loadModelAuthProfilesSync(), input.provider);
            return profile ? resolveRuntimeAuthFromProfile(profile) : null;
        },
    };
}
