// packages/cli/src/cli/utils/dexto-api-client.ts

import { logger } from '@dexto/core';

interface ProvisionResponse {
    success: boolean;
    dextoApiKey?: string;
    keyId?: string;
    isNewKey?: boolean;
    error?: string;
}

/**
 * Dexto API client for key management
 */
export class DextoApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    /**
     * Validate if a Dexto API key is valid
     */
    async validateDextoApiKey(apiKey: string): Promise<boolean> {
        try {
            logger.debug('Validating DEXTO_API_KEY');

            const response = await fetch(`${this.baseUrl}/api/keys/validate`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) {
                return false;
            }

            const result: { valid: boolean } = await response.json();
            return result.valid;
        } catch (error) {
            logger.error(`Error validating Dexto API key: ${error}`);
            return false;
        }
    }

    /**
     * Rotate Dexto API key (revoke old and create new)
     */
    async rotateDextoApiKey(
        authToken: string
    ): Promise<{ dextoApiKey: string; keyId: string; isNewKey: boolean }> {
        try {
            logger.debug('Rotating DEXTO_API_KEY');

            const response = await fetch(`${this.baseUrl}/api/keys/rotate`, {
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
                throw new Error(result.error || 'Failed to rotate Dexto API key');
            }

            if (!result.dextoApiKey || !result.keyId) {
                throw new Error('Invalid response from API');
            }

            logger.debug(`Successfully rotated DEXTO_API_KEY: ${result.keyId}`);
            return {
                dextoApiKey: result.dextoApiKey,
                keyId: result.keyId,
                isNewKey: result.isNewKey ?? true,
            };
        } catch (error) {
            logger.error(`Error rotating Dexto API key: ${error}`);
            throw error;
        }
    }
}

/**
 * Get default Dexto API client
 */
export async function getDextoApiClient(): Promise<DextoApiClient> {
    const { DEXTO_API_URL } = await import('./constants.js');
    return new DextoApiClient(DEXTO_API_URL);
}
