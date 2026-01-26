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
    private readonly timeoutMs = 10_000; // 10 second timeout for API calls

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
                signal: AbortSignal.timeout(this.timeoutMs),
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
     * Provision Dexto API key (get existing or create new with given name)
     * @param regenerate - If true, delete existing key and create new one
     */
    async provisionDextoApiKey(
        authToken: string,
        name: string = 'Dexto CLI Key',
        regenerate: boolean = false
    ): Promise<{ dextoApiKey: string; keyId: string; isNewKey: boolean }> {
        try {
            logger.debug(
                `Provisioning DEXTO_API_KEY with name: ${name}, regenerate: ${regenerate}`
            );

            const response = await fetch(`${this.baseUrl}/keys/provision`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, regenerate }),
                signal: AbortSignal.timeout(this.timeoutMs),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed: ${response.status} ${errorText}`);
            }

            const result: ProvisionResponse = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to provision Dexto API key');
            }

            if (!result.keyId) {
                throw new Error('Invalid response from API');
            }

            // If isNewKey is false, the key already exists (we don't get the key value back)
            // This is expected - the key was already provisioned
            if (!result.isNewKey && !result.dextoApiKey) {
                logger.debug(`DEXTO_API_KEY already exists: ${result.keyId}`);
                return {
                    dextoApiKey: '', // Empty - key already exists, not returned for security
                    keyId: result.keyId,
                    isNewKey: false,
                };
            }

            if (!result.dextoApiKey) {
                throw new Error('Invalid response from API - missing key');
            }

            logger.debug(`Successfully provisioned DEXTO_API_KEY: ${result.keyId}`);
            return {
                dextoApiKey: result.dextoApiKey,
                keyId: result.keyId,
                isNewKey: result.isNewKey ?? true,
            };
        } catch (error) {
            logger.error(`Error provisioning Dexto API key: ${error}`);
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
                signal: AbortSignal.timeout(this.timeoutMs),
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
