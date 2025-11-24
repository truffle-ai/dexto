import { createDextoClient } from '@dexto/client-sdk';
import { getApiUrl } from './api-url';

/**
 * Centralized typed API client for the Web UI.
 * Uses the Hono typed client from @dexto/client-sdk.
 */
export const client = createDextoClient({
    baseUrl: getApiUrl(),
});
