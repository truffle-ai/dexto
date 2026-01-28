// packages/cli/src/cli/utils/dexto-setup.ts

import { getDextoApiKey, isAuthenticated } from '../auth/index.js';

/**
 * Check if user can use Dexto provider.
 * Requires BOTH:
 * 1. User is authenticated (valid auth token from dexto login)
 * 2. Has DEXTO_API_KEY (from auth config or environment)
 */
export async function canUseDextoProvider(): Promise<boolean> {
    const authenticated = await isAuthenticated();
    if (!authenticated) return false;

    const apiKey = await getDextoApiKey();
    if (!apiKey) return false;

    return true;
}
