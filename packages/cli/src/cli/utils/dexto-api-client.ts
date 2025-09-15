// packages/cli/src/cli/utils/dexto-api-client.ts

import { logger } from '@dexto/core';

interface ProvisionResponse {
    success: boolean;
    apiKey?: string;
    keyId?: string;
    error?: string;
}

/**
 * Dexto API client for OpenRouter provisioning
 */
export class DextoApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    /**
     * Provision OpenRouter API key for authenticated user
     */
    async provisionOpenRouterKey(authToken: string): Promise<{ apiKey: string; keyId: string }> {
        try {
            logger.debug('Requesting OpenRouter API key from Dexto API');

            const response = await fetch(`${this.baseUrl}/api/openrouter-provision`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed: ${response.status} ${errorText}`);
            }

            const result: ProvisionResponse = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to provision OpenRouter API key');
            }

            if (!result.apiKey || !result.keyId) {
                throw new Error('Invalid response from API');
            }

            logger.debug(`Successfully provisioned OpenRouter API key: ${result.keyId}`);
            return {
                apiKey: result.apiKey,
                keyId: result.keyId,
            };
        } catch (error) {
            logger.error(`Error provisioning OpenRouter API key: ${error}`);
            throw error;
        }
    }
}

/**
 * Get default Dexto API client
 */
export async function getDextoApiClient(): Promise<DextoApiClient> {
    const { DEXTO_API_URL } = await import('./oauth-flow.js');
    return new DextoApiClient(DEXTO_API_URL);
}
