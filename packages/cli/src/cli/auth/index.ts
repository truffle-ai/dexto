// packages/cli/src/cli/auth/index.ts
// Public exports for auth module

export {
    type AuthConfig,
    storeAuth,
    loadAuth,
    removeAuth,
    isAuthenticated,
    getAuthToken,
    getDextoApiKey,
    getAuthFilePath,
} from './service.js';

export { type AuthenticatedUser, type AuthLoginResult } from './types.js';

export { type DeviceLoginPrompt, performDeviceCodeLogin } from './device.js';

export {
    type PersistOAuthLoginOptions,
    type PersistedLoginResult,
    persistOAuthLoginResult,
} from './login-persistence.js';

export { type UsageSummaryResponse, DextoApiClient, getDextoApiClient } from './api-client.js';

export { SUPABASE_URL, SUPABASE_ANON_KEY, DEXTO_API_URL } from './constants.js';

export {
    type DextoApiKeyProvisionStatus,
    type DextoApiKeyProvisionStatusLevel,
    type EnsureDextoApiKeyOptions,
    ensureDextoApiKeyForAuthToken,
    saveDextoApiKeyToEnv,
    removeDextoApiKeyFromEnv,
} from './dexto-api-key.js';
