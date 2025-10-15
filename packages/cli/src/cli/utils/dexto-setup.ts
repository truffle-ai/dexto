// packages/cli/src/cli/utils/dexto-setup.ts

import { logger } from '@dexto/core';
import { getDextoApiKey } from './auth-service.js';
import { saveProviderApiKey } from '@dexto/core';

/**
 * Dexto AI Gateway configuration for CLI users
 */
export const DEXTO_CONFIG = {
    provider: 'dexto' as const,
    router: 'vercel' as const,
};

/**
 * Set up DEXTO_API_KEY in environment if user has a provisioned key
 */
export async function setupDextoIfAvailable(): Promise<boolean> {
    try {
        const dextoKey = await getDextoApiKey();

        if (!dextoKey) {
            logger.debug('No DEXTO_API_KEY found in auth config');
            return false;
        }

        // Set the Dexto API key in the environment
        const { envVar, targetEnvPath } = await saveProviderApiKey('dexto', dextoKey);

        logger.debug(`DEXTO_API_KEY configured: ${envVar} -> ${targetEnvPath}`);
        return true;
    } catch (error) {
        logger.warn(`Failed to setup DEXTO_API_KEY: ${error}`);
        return false;
    }
}

/**
 * Get Dexto configuration for agent configs
 * Note: baseURL is automatically injected at runtime (https://api.dexto.ai/v1)
 */
export function getDextoLLMConfig(model: string) {
    return {
        provider: DEXTO_CONFIG.provider,
        model,
        router: DEXTO_CONFIG.router,
        // baseURL intentionally omitted - injected at runtime in config/writer.ts
        apiKey: '$DEXTO_API_KEY', // Will be resolved from environment
    };
}

/**
 * Check if Dexto is available and configured
 */
export async function isDextoAvailable(): Promise<boolean> {
    const dextoKey = await getDextoApiKey();
    return !!dextoKey;
}
