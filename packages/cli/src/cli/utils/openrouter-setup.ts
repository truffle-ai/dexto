// packages/cli/src/cli/utils/openrouter-setup.ts

import { logger } from '@dexto/core';
import { getOpenRouterApiKey } from './auth-service.js';
import { saveProviderApiKey } from '@dexto/core';

/**
 * OpenRouter configuration for CLI users
 */
export const OPENROUTER_CONFIG = {
    baseURL: 'https://openrouter.ai/api/v1',
    provider: 'openrouter' as const,
    router: 'vercel' as const,
};

/**
 * Set up OpenRouter API key in environment if user has a provisioned key
 */
export async function setupOpenRouterIfAvailable(): Promise<boolean> {
    try {
        const openRouterKey = await getOpenRouterApiKey();

        if (!openRouterKey) {
            logger.debug('No OpenRouter API key found in auth config');
            return false;
        }

        // Set the OpenRouter API key in the environment
        const { envVar, targetEnvPath } = await saveProviderApiKey('openrouter', openRouterKey);

        logger.debug(`OpenRouter API key configured: ${envVar} -> ${targetEnvPath}`);
        return true;
    } catch (error) {
        logger.warn(`Failed to setup OpenRouter API key: ${error}`);
        return false;
    }
}

/**
 * Get OpenRouter configuration for agent configs
 */
export function getOpenRouterLLMConfig(model: string) {
    return {
        provider: OPENROUTER_CONFIG.provider,
        model,
        router: OPENROUTER_CONFIG.router,
        baseURL: OPENROUTER_CONFIG.baseURL,
        apiKey: '$OPENROUTER_API_KEY', // Will be resolved from environment
    };
}

/**
 * Check if OpenRouter is available and configured
 */
export async function isOpenRouterAvailable(): Promise<boolean> {
    const openRouterKey = await getOpenRouterApiKey();
    return !!openRouterKey;
}
