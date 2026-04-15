// packages/cli/src/cli/auth/api-client.ts
// Dexto API client for auth/key/account APIs

// TODO: Migrate to typed client for type safety and better DX
// Options:
// 1. Migrate dexto-web APIs to Hono and use @hono/client (like packages/server)
// 2. Use openapi-fetch with generated types from OpenAPI spec
// 3. Use tRPC if we want full-stack type safety
// Currently using plain fetch() with runtime response validation.

import { logger } from '@dexto/core';
import { DEXTO_PLATFORM_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './constants.js';
import type { AuthenticatedUser } from './types.js';

interface PlatformKeyRecord {
    id: string;
    name: string | null;
    status: string;
    isActive: boolean;
}

interface PlatformKeyListResponse {
    success: boolean;
    data: PlatformKeyRecord[];
    error?: string;
}

interface PlatformCreateKeyResponse {
    success: boolean;
    data?: {
        id: string;
        fullKey: string;
    };
    error?: string;
}

export interface DeviceCodeStartResponse {
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    verificationUrlComplete: string | null;
    expiresIn: number;
    interval: number;
}

export interface DeviceCodeTokenResponse {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number | null;
    expiresAt?: number | null;
}

export type DeviceCodePollResponse =
    | { status: 'pending' }
    | { status: 'slowDown' }
    | { status: 'expired' }
    | { status: 'denied' }
    | { status: 'transientError' }
    | { status: 'success'; token: DeviceCodeTokenResponse };

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

function parseBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
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

function parseDeviceCodeStartResponse(payload: unknown): DeviceCodeStartResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid device start response');
    }

    const deviceCode =
        parseString(Reflect.get(payload, 'device_code')) ??
        parseString(Reflect.get(payload, 'deviceCode'));
    const userCode =
        parseString(Reflect.get(payload, 'user_code')) ??
        parseString(Reflect.get(payload, 'userCode'));
    const verificationUrl =
        parseString(Reflect.get(payload, 'verification_uri')) ??
        parseString(Reflect.get(payload, 'verificationUrl'));
    const verificationUrlComplete =
        parseString(Reflect.get(payload, 'verification_uri_complete')) ??
        parseString(Reflect.get(payload, 'verificationUrlComplete'));
    const expiresIn =
        parseNumber(Reflect.get(payload, 'expires_in')) ??
        parseNumber(Reflect.get(payload, 'expiresIn'));
    const interval = parseNumber(Reflect.get(payload, 'interval'));

    if (!deviceCode || !userCode || !verificationUrl || !expiresIn || !interval) {
        throw new Error('Device start response missing required fields');
    }

    return {
        deviceCode,
        userCode,
        verificationUrl,
        verificationUrlComplete,
        expiresIn,
        interval,
    };
}

function parseDeviceCodeTokenResponse(payload: unknown): DeviceCodeTokenResponse | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    const accessToken =
        parseString(Reflect.get(payload, 'accessToken')) ??
        parseString(Reflect.get(payload, 'access_token'));
    if (!accessToken) {
        return null;
    }

    const refreshToken =
        parseString(Reflect.get(payload, 'refreshToken')) ??
        parseString(Reflect.get(payload, 'refresh_token'));
    const expiresIn =
        parseNumber(Reflect.get(payload, 'expiresIn')) ??
        parseNumber(Reflect.get(payload, 'expires_in'));
    const expiresAt =
        parseNumber(Reflect.get(payload, 'expiresAt')) ??
        parseNumber(Reflect.get(payload, 'expires_at'));

    return {
        accessToken,
        refreshToken,
        expiresIn,
        expiresAt,
    };
}

function parseDeviceErrorCode(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    return parseString(Reflect.get(payload, 'error'));
}

function isTransientDevicePollErrorCode(errorCode: string): boolean {
    return (
        errorCode === 'server_error' ||
        errorCode === 'temporary_unavailable' ||
        errorCode === 'temporarily_unavailable'
    );
}

function parseSupabaseUser(payload: unknown): AuthenticatedUser | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    const id = parseString(Reflect.get(payload, 'id'));
    const email = parseString(Reflect.get(payload, 'email'));

    if (!id || !email) {
        return null;
    }

    const userMetadata = Reflect.get(payload, 'user_metadata');
    const fullName =
        typeof userMetadata === 'object' && userMetadata !== null
            ? parseString(Reflect.get(userMetadata, 'full_name'))
            : null;

    return {
        id,
        email,
        name: fullName ?? email,
    };
}

function parseUsageByModel(payload: unknown): UsageSummaryResponse['mtd_usage']['by_model'] {
    if (typeof payload !== 'object' || payload === null) {
        return {};
    }

    const byModel: UsageSummaryResponse['mtd_usage']['by_model'] = {};

    for (const [model, value] of Object.entries(payload)) {
        if (typeof value !== 'object' || value === null) {
            continue;
        }

        const requests = parseNumber(Reflect.get(value, 'requests'));
        const costUsd = parseNumber(Reflect.get(value, 'cost_usd'));
        const tokens = parseNumber(Reflect.get(value, 'tokens'));

        if (requests === null || costUsd === null || tokens === null) {
            continue;
        }

        byModel[model] = {
            requests,
            cost_usd: costUsd,
            tokens,
        };
    }

    return byModel;
}

function parseRecentUsage(payload: unknown): UsageSummaryResponse['recent'] {
    if (!Array.isArray(payload)) {
        return [];
    }

    const entries: UsageSummaryResponse['recent'] = [];

    for (const entry of payload) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
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
            continue;
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

    const creditsUsd = parseNumber(Reflect.get(payload, 'credits_usd'));
    const mtdUsage = Reflect.get(payload, 'mtd_usage');

    if (creditsUsd === null || typeof mtdUsage !== 'object' || mtdUsage === null) {
        throw new Error('Invalid response from API');
    }

    const totalCostUsd = parseNumber(Reflect.get(mtdUsage, 'total_cost_usd'));
    const totalRequests = parseNumber(Reflect.get(mtdUsage, 'total_requests'));

    if (totalCostUsd === null || totalRequests === null) {
        throw new Error('Invalid response from API');
    }

    const byModel = parseUsageByModel(Reflect.get(mtdUsage, 'by_model'));
    const recent = parseRecentUsage(Reflect.get(payload, 'recent'));

    return {
        credits_usd: creditsUsd,
        mtd_usage: {
            total_cost_usd: totalCostUsd,
            total_requests: totalRequests,
            by_model: byModel,
        },
        recent,
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

function parseValidateResponse(payload: unknown): boolean {
    if (typeof payload !== 'object' || payload === null) {
        return false;
    }

    const valid = parseBoolean(Reflect.get(payload, 'valid'));
    return valid ?? false;
}

function parsePlatformKeyListResponse(payload: unknown): PlatformKeyListResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid response from API');
    }

    const success = parseBoolean(Reflect.get(payload, 'success'));
    if (success !== true) {
        const error = parseString(Reflect.get(payload, 'error'));
        throw new Error(error || 'Failed to fetch API keys');
    }

    const data = Reflect.get(payload, 'data');
    if (!Array.isArray(data)) {
        throw new Error('Invalid response from API');
    }

    const keys: PlatformKeyRecord[] = [];
    for (const entry of data) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }

        const id = parseString(Reflect.get(entry, 'id'));
        const name = parseString(Reflect.get(entry, 'name'));
        const status = parseString(Reflect.get(entry, 'status'));
        const isActive = parseBoolean(Reflect.get(entry, 'isActive'));

        if (!id || !status || isActive === null) {
            continue;
        }

        keys.push({ id, name, status, isActive });
    }

    return { success: true, data: keys };
}

function parsePlatformCreateKeyResponse(payload: unknown): PlatformCreateKeyResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid response from API');
    }

    const success = parseBoolean(Reflect.get(payload, 'success'));
    if (success !== true) {
        const error = parseString(Reflect.get(payload, 'error'));
        return { success: false, error: error || 'Failed to create API key' };
    }

    const data = Reflect.get(payload, 'data');
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid response from API');
    }

    const id = parseString(Reflect.get(data, 'id'));
    const fullKey = parseString(Reflect.get(data, 'fullKey'));
    if (!id || !fullKey) {
        throw new Error('Invalid response from API');
    }

    return {
        success: true,
        data: { id, fullKey },
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

/**
 * Dexto API client for key management
 */
export class DextoApiClient {
    private readonly platformBaseUrl: string;
    private readonly timeoutMs = 10_000;

    constructor(
        baseUrl:
            | string
            | {
                  gatewayBaseUrl?: string | undefined;
                  platformBaseUrl?: string | undefined;
              } = {}
    ) {
        if (typeof baseUrl === 'string') {
            const normalized = baseUrl.replace(/\/+$/, '');
            this.platformBaseUrl = normalized;
            return;
        }

        this.platformBaseUrl = (
            baseUrl.platformBaseUrl ??
            baseUrl.gatewayBaseUrl ??
            DEXTO_PLATFORM_URL
        ).replace(/\/+$/, '');
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

    private async listPlatformApiKeys(authToken: string): Promise<PlatformKeyRecord[]> {
        const response = await fetch(this.getPlatformUrl('/api/keys'), {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${authToken}`,
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
        return parsePlatformKeyListResponse(payload).data;
    }

    private async createPlatformApiKey(
        authToken: string,
        name: string
    ): Promise<{ dextoApiKey: string; keyId: string }> {
        const response = await fetch(this.getPlatformUrl('/api/keys'), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name }),
            signal: this.createRequestSignal(undefined),
        });

        if (!response.ok) {
            const rawText = await response.text();
            throw new Error(
                `API request failed: ${formatHttpFailure(response.status, null, rawText)}`
            );
        }

        const payload: unknown = await response.json();
        const result = parsePlatformCreateKeyResponse(payload);

        if (!result.success || !result.data) {
            throw new Error(result.error || 'Failed to create Dexto API key');
        }

        return {
            dextoApiKey: result.data.fullKey,
            keyId: result.data.id,
        };
    }

    private async deletePlatformApiKey(authToken: string, keyId: string): Promise<void> {
        const response = await fetch(
            this.getPlatformUrl(`/api/keys/${encodeURIComponent(keyId)}`),
            {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                signal: this.createRequestSignal(undefined),
            }
        );

        if (!response.ok) {
            const rawText = await response.text();
            throw new Error(
                `API request failed: ${formatHttpFailure(response.status, null, rawText)}`
            );
        }
    }

    /**
     * Validate if a Dexto API key is valid
     */
    async validateDextoApiKey(apiKey: string): Promise<boolean> {
        try {
            logger.debug('Validating DEXTO_API_KEY');

            const response = await fetch(this.getPlatformUrl('/api/keys/validate'), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
                signal: this.createRequestSignal(undefined),
            });

            if (!response.ok) {
                return false;
            }

            const payload: unknown = await response.json();
            return parseValidateResponse(payload);
        } catch (error) {
            logger.error(`Error validating Dexto API key: ${error}`);
            return false;
        }
    }

    /**
     * Provision Dexto API key and always return a usable secret key value.
     * @param regenerate - If true, delete existing key(s) and create a new one
     */
    async provisionDextoApiKey(
        authToken: string,
        name: string = 'Dexto CLI Key',
        regenerate: boolean = false
    ): Promise<{ dextoApiKey: string; keyId: string }> {
        try {
            logger.debug(
                `Provisioning DEXTO_API_KEY with name: ${name}, regenerate: ${regenerate}`
            );

            const matchingKeys = (await this.listPlatformApiKeys(authToken)).filter(
                (key) => key.isActive && key.name === name
            );

            if (matchingKeys.length > 0) {
                if (!regenerate) {
                    logger.debug(
                        `Active key exists (${matchingKeys[0]?.id ?? 'unknown'}); rotating to obtain key value`
                    );
                }
                for (const key of matchingKeys) {
                    await this.deletePlatformApiKey(authToken, key.id);
                }
            }

            const createdKey = await this.createPlatformApiKey(authToken, name);
            logger.debug(`Successfully provisioned DEXTO_API_KEY: ${createdKey.keyId}`);
            return {
                dextoApiKey: createdKey.dextoApiKey,
                keyId: createdKey.keyId,
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

            const response = await fetch(this.getPlatformUrl('/api/account/usage'), {
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

    /**
     * Start device code login at the platform.
     */
    async startDeviceCodeLogin(
        client: string = 'dexto-cli',
        options: RequestOptions = {}
    ): Promise<DeviceCodeStartResponse> {
        const response = await fetch(this.getPlatformUrl('/api/auth/device/start'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ client }),
            signal: this.createRequestSignal(options.signal),
        });

        if (!response.ok) {
            if (response.status === 404 || response.status === 403) {
                throw new Error('Device code login is not enabled for this Dexto server');
            }

            const rawText = await response.text();
            throw new Error(
                `Device code login failed to start: ${formatHttpFailure(response.status, null, rawText)}`
            );
        }

        const payload: unknown = await response.json();
        return parseDeviceCodeStartResponse(payload);
    }

    /**
     * Poll the platform for device-code login completion.
     */
    async pollDeviceCodeLogin(
        deviceCode: string,
        options: RequestOptions = {}
    ): Promise<DeviceCodePollResponse> {
        let response: Response;
        try {
            response = await fetch(this.getPlatformUrl('/api/auth/device/poll'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ device_code: deviceCode }),
                signal: this.createRequestSignal(options.signal),
            });
        } catch (error) {
            if (options.signal?.aborted) {
                throw options.signal.reason instanceof Error
                    ? options.signal.reason
                    : new Error('Authentication cancelled');
            }
            logger.debug(
                `Device login poll request failed transiently: ${error instanceof Error ? error.message : String(error)}`
            );
            return { status: 'transientError' };
        }

        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
            if (response.status === 404 || response.status === 403) {
                throw new Error('Device code login is not enabled for this Dexto server');
            }
            if (response.status === 429) {
                return { status: 'slowDown' };
            }

            const errorCode = parseDeviceErrorCode(payload);
            if (errorCode === 'authorization_pending') {
                return { status: 'pending' };
            }
            if (errorCode === 'slow_down') {
                return { status: 'slowDown' };
            }
            if (errorCode === 'expired_token') {
                return { status: 'expired' };
            }
            if (errorCode === 'access_denied') {
                return { status: 'denied' };
            }
            if (errorCode && isTransientDevicePollErrorCode(errorCode)) {
                return { status: 'transientError' };
            }
            if (response.status >= 500) {
                return { status: 'transientError' };
            }
            if (errorCode) {
                throw new Error(`Device login failed: ${errorCode}`);
            }

            throw new Error(`Device login polling failed with status ${response.status}`);
        }

        const token = parseDeviceCodeTokenResponse(payload);
        if (token) {
            return {
                status: 'success',
                token,
            };
        }

        const errorCode = parseDeviceErrorCode(payload);
        if (errorCode === 'authorization_pending') {
            return { status: 'pending' };
        }
        if (errorCode === 'slow_down') {
            return { status: 'slowDown' };
        }
        if (errorCode === 'expired_token') {
            return { status: 'expired' };
        }
        if (errorCode === 'access_denied') {
            return { status: 'denied' };
        }
        if (errorCode && isTransientDevicePollErrorCode(errorCode)) {
            return { status: 'transientError' };
        }

        return { status: 'pending' };
    }

    /**
     * Fetch Supabase user profile for a bearer token.
     */
    async fetchSupabaseUser(
        accessToken: string,
        options: RequestOptions = {}
    ): Promise<AuthenticatedUser | undefined> {
        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    apikey: SUPABASE_ANON_KEY,
                    'User-Agent': 'dexto-cli/1.0.0',
                },
                signal: this.createRequestSignal(options.signal),
            });

            if (!response.ok) {
                return undefined;
            }

            const payload: unknown = await response.json();
            return parseSupabaseUser(payload) ?? undefined;
        } catch (error) {
            logger.debug(
                `Failed to fetch Supabase user profile: ${error instanceof Error ? error.message : String(error)}`
            );
            return undefined;
        }
    }

    /**
     * Validate Supabase access token by checking if /auth/v1/user resolves.
     */
    async validateSupabaseAccessToken(
        accessToken: string,
        options: RequestOptions = {}
    ): Promise<boolean> {
        const user = await this.fetchSupabaseUser(accessToken, options);
        return Boolean(user?.id);
    }
}

/**
 * Get default Dexto API client
 */
export function getDextoApiClient(): DextoApiClient {
    return new DextoApiClient();
}
