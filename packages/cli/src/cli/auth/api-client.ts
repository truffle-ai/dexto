// packages/cli/src/cli/auth/api-client.ts
// Dexto API client for auth/key/account APIs

// TODO: Migrate to typed client for type safety and better DX
// Options:
// 1. Migrate dexto-web APIs to Hono and use @hono/client (like packages/server)
// 2. Use openapi-fetch with generated types from OpenAPI spec
// 3. Use tRPC if we want full-stack type safety
// Currently using plain fetch() with runtime response validation.

import { logger } from '@dexto/core';
import { DEXTO_PLATFORM_URL, DEXTO_PUBLIC_API_URL } from './constants.js';

export interface UsageSummaryResponse {
    balance_usd: number;
    last_30_days: {
        since: string;
        total_cost_usd: number;
        total_usage_events: number;
    };
    recent_model_usage: Array<{
        timestamp: string;
        model: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
    }>;
}

export interface BillingBalanceResponse {
    creditsUsd: number;
}

export interface BillingCheckoutSessionResponse {
    checkoutUrl: string;
    checkoutSessionId: string;
}

interface RequestOptions {
    signal?: AbortSignal | undefined;
}

function parseString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function parseNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function parseRecentUsage(payload: unknown): UsageSummaryResponse['recent_model_usage'] {
    if (!Array.isArray(payload)) {
        throw new Error('Invalid response from API');
    }

    const entries: UsageSummaryResponse['recent_model_usage'] = [];

    for (const entry of payload) {
        if (typeof entry !== 'object' || entry === null) {
            throw new Error('Invalid response from API');
        }

        const timestamp = parseString(Reflect.get(entry, 'timestamp'));
        const model = parseString(Reflect.get(entry, 'model'));
        const costUsd = parseNumber(Reflect.get(entry, 'cost_usd'));
        const inputTokens = parseNumber(Reflect.get(entry, 'input_tokens'));
        const outputTokens = parseNumber(Reflect.get(entry, 'output_tokens'));

        if (
            !timestamp ||
            !model ||
            costUsd === null ||
            inputTokens === null ||
            outputTokens === null
        ) {
            throw new Error('Invalid response from API');
        }

        entries.push({
            timestamp,
            model,
            cost_usd: costUsd,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
        });
    }

    return entries;
}

function parseUsageSummaryResponse(payload: unknown): UsageSummaryResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid response from API');
    }

    const balanceUsd = parseNumber(Reflect.get(payload, 'balance_usd'));
    const last30Days = Reflect.get(payload, 'last_30_days');

    if (balanceUsd === null || typeof last30Days !== 'object' || last30Days === null) {
        throw new Error('Invalid response from API');
    }

    const since = parseString(Reflect.get(last30Days, 'since'));
    const totalCostUsd = parseNumber(Reflect.get(last30Days, 'total_cost_usd'));
    const totalUsageEvents = parseNumber(Reflect.get(last30Days, 'total_usage_events'));

    if (!since || totalCostUsd === null || totalUsageEvents === null) {
        throw new Error('Invalid response from API');
    }

    const recent = parseRecentUsage(Reflect.get(payload, 'recent_model_usage'));

    return {
        balance_usd: balanceUsd,
        last_30_days: {
            since,
            total_cost_usd: totalCostUsd,
            total_usage_events: totalUsageEvents,
        },
        recent_model_usage: recent,
    };
}

function parseBillingBalanceResponse(payload: unknown): BillingBalanceResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid response from API');
    }

    const creditsUsd =
        parseNumber(Reflect.get(payload, 'credits_usd')) ??
        parseNumber(Reflect.get(payload, 'creditsUsd'));

    if (creditsUsd === null) {
        throw new Error('Invalid response from API');
    }

    return { creditsUsd };
}

function parseBillingCheckoutSessionResponse(payload: unknown): BillingCheckoutSessionResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid response from API');
    }

    const checkoutUrl =
        parseString(Reflect.get(payload, 'checkout_url')) ??
        parseString(Reflect.get(payload, 'checkoutUrl'));
    const checkoutSessionId =
        parseString(Reflect.get(payload, 'checkout_session_id')) ??
        parseString(Reflect.get(payload, 'checkoutSessionId'));

    if (!checkoutUrl || !checkoutSessionId) {
        throw new Error('Invalid response from API');
    }

    return {
        checkoutUrl,
        checkoutSessionId,
    };
}

function formatHttpFailure(status: number, payload: unknown, rawText: string): string {
    if (rawText.trim().length > 0) {
        return `${status} ${rawText}`;
    }

    if (payload != null) {
        return `${status} ${JSON.stringify(payload)}`;
    }

    return `${status}`;
}

function normalizePublicApiBaseUrl(value: string): string {
    const normalized = value.replace(/\/+$/, '');
    const url = new URL(normalized);
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
        throw new Error('publicApiBaseUrl must use HTTPS unless it targets a loopback host');
    }

    return normalized;
}

/**
 * Dexto API client for key management
 */
export class DextoApiClient {
    private readonly platformBaseUrl: string;
    private readonly publicApiBaseUrl: string;
    private readonly timeoutMs = 10_000;

    constructor(
        baseUrl:
            | string
            | {
                  gatewayBaseUrl?: string | undefined;
                  platformBaseUrl?: string | undefined;
                  publicApiBaseUrl?: string | undefined;
              } = {}
    ) {
        if (typeof baseUrl === 'string') {
            const normalized = baseUrl.replace(/\/+$/, '');
            this.platformBaseUrl = normalized;
            this.publicApiBaseUrl = normalizePublicApiBaseUrl(normalized);
            return;
        }

        this.platformBaseUrl = (
            baseUrl.platformBaseUrl ??
            baseUrl.gatewayBaseUrl ??
            DEXTO_PLATFORM_URL
        ).replace(/\/+$/, '');
        this.publicApiBaseUrl = normalizePublicApiBaseUrl(
            baseUrl.publicApiBaseUrl ?? DEXTO_PUBLIC_API_URL
        );
    }

    private createRequestSignal(signal: AbortSignal | undefined): AbortSignal {
        const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
        if (!signal) {
            return timeoutSignal;
        }

        return AbortSignal.any([signal, timeoutSignal]);
    }

    private getPlatformUrl(path: string): string {
        return `${this.platformBaseUrl}${path}`;
    }

    private getPublicApiUrl(path: string): string {
        return `${this.publicApiBaseUrl}${path}`;
    }

    /**
     * Get usage summary (balance + last 30 days + recent model activity)
     */
    async getUsageSummary(apiKey: string): Promise<UsageSummaryResponse> {
        try {
            logger.debug('Fetching usage summary');

            const response = await fetch(this.getPublicApiUrl('/v1/billing/summary'), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
                signal: this.createRequestSignal(undefined),
            });

            if (!response.ok) {
                const rawText = await response.text();
                throw new Error(
                    `API request failed: ${formatHttpFailure(response.status, null, rawText)}`
                );
            }

            const payload: unknown = await response.json();
            return parseUsageSummaryResponse(payload);
        } catch (error) {
            logger.error(`Error fetching usage summary: ${error}`);
            throw error;
        }
    }

    /**
     * Get the current Dexto billing balance for the authenticated user.
     */
    async getBillingBalance(
        authToken: string,
        options: RequestOptions
    ): Promise<BillingBalanceResponse> {
        try {
            logger.debug('Fetching billing balance');

            const response = await fetch(this.getPlatformUrl('/api/billing/balance'), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                signal: this.createRequestSignal(options.signal),
            });

            if (!response.ok) {
                const rawText = await response.text();
                throw new Error(
                    `API request failed: ${formatHttpFailure(response.status, null, rawText)}`
                );
            }

            const payload: unknown = await response.json();
            return parseBillingBalanceResponse(payload);
        } catch (error) {
            logger.error('Error fetching billing balance', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Create a hosted top-up checkout session for the authenticated user.
     */
    async createBillingCheckoutSession(
        authToken: string,
        options: {
            creditsUsd: number;
            returnUrl?: string | undefined;
            signal?: AbortSignal | undefined;
        }
    ): Promise<BillingCheckoutSessionResponse> {
        try {
            if (!Number.isFinite(options.creditsUsd) || options.creditsUsd <= 0) {
                throw new Error('creditsUsd must be a positive number');
            }

            logger.debug('Creating billing checkout session', {
                creditsUsd: options.creditsUsd,
            });

            const response = await fetch(this.getPlatformUrl('/api/billing/checkout-session'), {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    credits_usd: options.creditsUsd,
                    ...(options.returnUrl ? { return_url: options.returnUrl } : {}),
                }),
                signal: this.createRequestSignal(options.signal),
            });

            if (!response.ok) {
                const rawText = await response.text();
                throw new Error(
                    `API request failed: ${formatHttpFailure(response.status, null, rawText)}`
                );
            }

            const payload: unknown = await response.json();
            return parseBillingCheckoutSessionResponse(payload);
        } catch (error) {
            logger.error('Error creating billing checkout session', {
                error: error instanceof Error ? error.message : String(error),
                creditsUsd: options.creditsUsd,
            });
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
