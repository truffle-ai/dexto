// packages/cli/src/cli/auth/index.ts
// Public exports for auth module

export {
    type AuthConfig,
    storeAuth,
    loadAuth,
    removeAuth,
    isAuthenticated,
    getAuthToken,
    getAuthTokenQuietly,
    getDextoApiKey,
    getAuthFilePath,
} from './service.js';

export { type UsageSummaryResponse, DextoApiClient, getDextoApiClient } from './api-client.js';

export {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    DEXTO_API_URL,
    DEXTO_PLATFORM_URL,
    DEXTO_PUBLIC_API_URL,
} from './constants.js';

export {
    buildDextoBillingUrl,
    getBillingBalanceForCurrentLogin,
    createBillingCheckoutForCurrentLogin,
    openDextoBillingPage,
} from './billing.js';
