// packages/cli/src/cli/auth/api-client.ts
// Dexto API client for key management and usage

// TODO: Migrate to typed client for type safety and better DX
// Options:
// 1. Migrate dexto-web APIs to Hono and use @hono/client (like packages/server)
// 2. Use openapi-fetch with generated types from OpenAPI spec
// 3. Use tRPC if we want full-stack type safety
// Currently using plain fetch() with manual type definitions.

import { logger } from '@dexto/core';
import { DEXTO_API_URL } from './constants.js';

interface ProvisionResponse {
    success: boolean;
    dextoApiKey?: string;
    keyId?: string;
    isNewKey?: boolean;
    error?: string;
}

export interface UsageSummaryResponse {
    credits_usd: number;
    mtd_usage: {
        total_cost_usd: number;
        total_requests: number;
        by_model: Record<
            string,
            {
                requests: number;
                cost_usd: number;
                tokens: number;
            }
        >;
    };
    recent: Array<{
        timestamp: string;
        model: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
    }>;
}

/**
 * Dexto API client for key management
 */
export class DextoApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string = DEXTO_API_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Validate if a Dexto API key is valid
     */
    async validateDextoApiKey(apiKey: string): Promise<boolean> {
        try {
            logger.debug('Validating DEXTO_API_KEY');

            const response = await fetch(`${this.baseUrl}/keys/validate`, {
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

            const response = await fetch(`${this.baseUrl}/keys/rotate`, {
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

    /**
     * Get usage summary (balance + MTD usage + recent history)
     */
    async getUsageSummary(apiKey: string): Promise<UsageSummaryResponse> {
        try {
            logger.debug('Fetching usage summary');

            const response = await fetch(`${this.baseUrl}/me/usage`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed: ${response.status} ${errorText}`);
            }

            const result: UsageSummaryResponse = await response.json();
            return result;
        } catch (error) {
            logger.error(`Error fetching usage summary: ${error}`);
            throw error;
        }
    }
}

/**
 * Get default Dexto API client
 */
export function getDextoApiClient(): DextoApiClient {
    return new DextoApiClient();
}
