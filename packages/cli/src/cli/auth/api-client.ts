// packages/cli/src/cli/auth/api-client.ts
// Dexto API client for key management and usage

// TODO: Migrate to typed client for type safety and better DX
// Options:
// 1. Migrate dexto-web APIs to Hono and use @hono/client (like packages/server)
// 2. Use openapi-fetch with generated types from OpenAPI spec
// 3. Use tRPC if we want full-stack type safety
// Currently using plain fetch() with runtime response validation.

import { logger } from '@dexto/core';
import { DEXTO_API_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './constants.js';
import type { AuthenticatedUser } from './types.js';

interface ProvisionResponse {
    success: boolean;
    dextoApiKey?: string;
    keyId?: string;
    isNewKey?: boolean;
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

function parseProvisionResponse(payload: unknown): ProvisionResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid response from API');
    }

    const success = parseBoolean(Reflect.get(payload, 'success'));
    if (success === null) {
        throw new Error('Invalid response from API');
    }

    const dextoApiKey = parseString(Reflect.get(payload, 'dextoApiKey')) ?? undefined;
    const keyId = parseString(Reflect.get(payload, 'keyId')) ?? undefined;
    const isNewKey = parseBoolean(Reflect.get(payload, 'isNewKey')) ?? undefined;
    const error = parseString(Reflect.get(payload, 'error')) ?? undefined;

    const result: ProvisionResponse = {
        success,
    };
    if (dextoApiKey) {
        result.dextoApiKey = dextoApiKey;
    }
    if (keyId) {
        result.keyId = keyId;
    }
    if (isNewKey !== undefined) {
        result.isNewKey = isNewKey;
    }
    if (error) {
        result.error = error;
    }

    return result;
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

function parseValidateResponse(payload: unknown): boolean {
    if (typeof payload !== 'object' || payload === null) {
        return false;
    }

    const valid = parseBoolean(Reflect.get(payload, 'valid'));
    return valid ?? false;
}

function formatHttpFailure(status: number, payload: unknown, rawText: string): string {
    if (rawText.trim().length > 0) {
        return `${status} ${rawText}`;
    }

    if (payload !== null) {
        return `${status} ${JSON.stringify(payload)}`;
    }

    return `${status}`;
}

/**
 * Dexto API client for key management
 */
export class DextoApiClient {
    private readonly baseUrl: string;
    private readonly timeoutMs = 10_000;

    constructor(baseUrl: string = DEXTO_API_URL) {
        this.baseUrl = baseUrl;
    }

    private createRequestSignal(signal: AbortSignal | undefined): AbortSignal {
        const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
        if (!signal) {
            return timeoutSignal;
        }

        return AbortSignal.any([signal, timeoutSignal]);
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
                signal: this.createRequestSignal(undefined),
            });

            if (!response.ok) {
                const rawText = await response.text();
                throw new Error(
                    `API request failed: ${formatHttpFailure(response.status, null, rawText)}`
                );
            }

            const payload: unknown = await response.json();
            const result = parseProvisionResponse(payload);

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
     * Start device code login at the gateway.
     */
    async startDeviceCodeLogin(
        client: string = 'dexto-cli',
        options: RequestOptions = {}
    ): Promise<DeviceCodeStartResponse> {
        const response = await fetch(`${this.baseUrl}/auth/device/start`, {
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
     * Poll the gateway for device-code login completion.
     */
    async pollDeviceCodeLogin(
        deviceCode: string,
        options: RequestOptions = {}
    ): Promise<DeviceCodePollResponse> {
        const response = await fetch(`${this.baseUrl}/auth/device/poll`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ device_code: deviceCode }),
            signal: this.createRequestSignal(options.signal),
        });

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
