// packages/cli/src/cli/utils/dexto-api-client.ts

import { logger } from '@dexto/core';

interface ProvisionResponse {
    success: boolean;
    // Legacy (OpenRouter provisioning endpoint)
    apiKey?: string;
    // New (Gateway provisioning endpoint)
    dextoApiKey?: string;
    keyId?: string;
    isNewKey?: boolean;
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
     * Provision OpenRouter API key for authenticated user (legacy path)
     */
    async provisionOpenRouterKey(
        authToken: string
    ): Promise<{ apiKey: string; keyId: string; isNewKey: boolean }> {
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
                isNewKey: result.isNewKey ?? false,
            };
        } catch (error) {
            logger.error(
                `Error provisioning OpenRouter API key at ${this.baseUrl}/api/openrouter-provision: ${error}`
            );
            throw error;
        }
    }

    /**
     * Provision Dexto API key (DEXTO_API_KEY); server also ensures per-user OpenRouter key exists.
     */
    async provisionDextoApiKey(
        authToken: string
    ): Promise<{ dextoApiKey: string; keyId: string; isNewKey: boolean }> {
        try {
            logger.debug('Requesting DEXTO_API_KEY from Dexto API');

            const response = await fetch(`${this.baseUrl}/api/provision`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed: ${response.status} ${errorText}`);
            }

            const result: ProvisionResponse = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to provision Dexto API key');
            }

            const key = result.dextoApiKey;
            if (!key || !result.keyId) {
                throw new Error('Invalid response from API');
            }

            logger.debug(`Successfully provisioned DEXTO_API_KEY: ${result.keyId}`);
            return {
                dextoApiKey: key,
                keyId: result.keyId,
                isNewKey: result.isNewKey ?? false,
            };
        } catch (error) {
            logger.error(
                `Error provisioning Dexto API key at ${this.baseUrl}/api/provision: ${error}`
            );
            throw error;
        }
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
