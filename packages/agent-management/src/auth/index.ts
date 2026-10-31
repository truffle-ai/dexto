export {
    AUTH_METHOD_KINDS,
    OPENAI_API_KEY_AUTH_METHOD,
    OPENAI_CHATGPT_LOGIN_AUTH_METHOD,
    PROVIDER_AUTH_DEFINITIONS,
    getAuthMethodDefinition,
    getProviderAuthDefinition,
    getProviderAuthDefinitions,
    isOAuthAuthMethod,
    type ApiKeyAuthMethodDefinition,
    type AuthMethodDefinition,
    type AuthMethodKind,
    type OAuthAuthMethodDefinition,
    type ProviderAuthDefinition,
} from './provider-auth-definitions.js';

export {
    createModelAuthResolver,
    markModelAuthProviderConnected,
    saveChatGPTLoginModelAuthProfile,
    startModelAuthBrowserLogin,
    type PendingModelAuthBrowserLogin,
} from './model-auth-handlers.js';

export {
    deleteModelAuthProfile,
    getDefaultModelAuthProfile,
    getDefaultModelAuthProfileIdForProvider,
    getModelAuthProfileId,
    getModelAuthProfilesPath,
    listModelAuthProfiles,
    listSavedModelAuthProfiles,
    loadModelAuthProfiles,
    loadModelAuthProfilesSync,
    saveApiKeyModelAuthProfile,
    setDefaultModelAuthProfile,
    upsertModelAuthProfile,
    type ApiKeyEnvModelAuthCredential,
    type ModelAuthCredential,
    type ModelAuthProfile,
    type ModelAuthProfilesFile,
    type OAuthModelAuthCredential,
} from './model-auth-profiles.js';

export {
    createChatGPTRuntimeAuth,
    refreshChatGPTOAuthCredential,
    startChatGPTBrowserLogin,
    type ChatGPTOAuthCredential,
    type ChatGPTRuntimeAuth,
    type PendingChatGPTLogin,
} from './chatgpt-oauth.js';

/** Signing in to Dexto as the `dexto-cli` client: saved profiles, OAuth and the Cloud reads it needs. */
export * as dextoAccounts from './dexto-accounts.js';
export * as dextoSignIn from './dexto-sign-in.js';
export * as dextoCloud from './dexto-cloud.js';
export * as dextoGateway from './dexto-gateway.js';
