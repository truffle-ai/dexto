// packages/cli/src/cli/auth/device.ts
// Device code login flow for browserless environments.

import { logger } from '@dexto/core';
import { DEXTO_API_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './constants.js';
import type { OAuthResult } from './oauth.js';

interface DeviceStartResponse {
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    verificationUrlComplete: string | null;
    expiresIn: number;
    interval: number;
}

export interface DeviceLoginPrompt {
    userCode: string;
    verificationUrl: string;
    verificationUrlComplete: string | null;
    expiresIn: number;
}

export interface DeviceLoginOptionsInput {
    apiUrl?: string;
    signal?: AbortSignal;
    onPrompt?: ((prompt: DeviceLoginPrompt) => void) | undefined;
}

interface DeviceLoginOptions {
    apiUrl: string;
    signal: AbortSignal | null;
    onPrompt: (prompt: DeviceLoginPrompt) => void;
}

interface DevicePollTokenResponse {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number | null;
    expiresAt?: number | null;
}

function resolveDeviceLoginOptions(options: DeviceLoginOptionsInput): DeviceLoginOptions {
    return {
        apiUrl: options.apiUrl ?? DEXTO_API_URL,
        signal: options.signal ?? null,
        onPrompt: options.onPrompt ?? (() => undefined),
    };
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

function parseDeviceStartResponse(payload: unknown): DeviceStartResponse {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid device start response');
    }

    const data = payload as Record<string, unknown>;
    const deviceCode = parseString(data.device_code) ?? parseString(data.deviceCode);
    const userCode = parseString(data.user_code) ?? parseString(data.userCode);
    const verificationUrl = parseString(data.verification_uri) ?? parseString(data.verificationUrl);
    const verificationUrlComplete =
        parseString(data.verification_uri_complete) ?? parseString(data.verificationUrlComplete);
    const expiresIn = parseNumber(data.expires_in) ?? parseNumber(data.expiresIn);
    const interval = parseNumber(data.interval);

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

function parseDevicePollTokenResponse(payload: unknown): DevicePollTokenResponse | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    const data = payload as Record<string, unknown>;
    const accessToken = parseString(data.accessToken) ?? parseString(data.access_token);
    if (!accessToken) {
        return null;
    }

    const refreshToken = parseString(data.refreshToken) ?? parseString(data.refresh_token);
    const expiresIn = parseNumber(data.expiresIn) ?? parseNumber(data.expires_in);
    const expiresAt = parseNumber(data.expiresAt) ?? parseNumber(data.expires_at);

    return {
        accessToken,
        refreshToken,
        expiresIn,
        expiresAt,
    };
}

function parseErrorCode(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    const data = payload as Record<string, unknown>;
    return parseString(data.error);
}

async function sleepWithAbort(ms: number, signal: AbortSignal | null): Promise<void> {
    if (signal?.aborted) {
        throw signal.reason instanceof Error
            ? signal.reason
            : new Error('Authentication cancelled');
    }

    if (!signal) {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            reject(
                signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Authentication cancelled')
            );
        };

        signal.addEventListener('abort', onAbort, { once: true });
    });
}

async function fetchUserFromToken(
    accessToken: string
): Promise<{ id: string; email: string; name?: string | undefined } | undefined> {
    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: SUPABASE_ANON_KEY,
            },
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            return undefined;
        }

        const userData = (await response.json()) as Record<string, unknown>;
        const id = parseString(userData.id);
        const email = parseString(userData.email);

        if (!id || !email) {
            return undefined;
        }

        const metadata =
            typeof userData.user_metadata === 'object' && userData.user_metadata !== null
                ? (userData.user_metadata as Record<string, unknown>)
                : null;
        const fullName = metadata ? parseString(metadata.full_name) : null;

        return {
            id,
            email,
            name: fullName ?? email,
        };
    } catch (error) {
        logger.debug(
            `Failed to fetch user profile for device login: ${error instanceof Error ? error.message : String(error)}`
        );
        return undefined;
    }
}

export async function performDeviceCodeLogin(
    optionsInput: DeviceLoginOptionsInput = {}
): Promise<OAuthResult> {
    const options = resolveDeviceLoginOptions(optionsInput);
    const startResponse = await fetch(`${options.apiUrl}/auth/device/start`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ client: 'dexto-cli' }),
        signal: options.signal ?? AbortSignal.timeout(10_000),
    });

    if (!startResponse.ok) {
        if (startResponse.status === 404 || startResponse.status === 403) {
            throw new Error('Device code login is not enabled for this Dexto server');
        }
        const responseText = await startResponse.text();
        throw new Error(
            `Device code login failed to start: ${startResponse.status} ${responseText}`
        );
    }

    const startPayload = await startResponse.json();
    const start = parseDeviceStartResponse(startPayload);
    options.onPrompt({
        userCode: start.userCode,
        verificationUrl: start.verificationUrl,
        verificationUrlComplete: start.verificationUrlComplete,
        expiresIn: start.expiresIn,
    });

    const deadline = Date.now() + start.expiresIn * 1000;
    let pollIntervalMs = Math.max(1, Math.floor(start.interval)) * 1000;

    while (Date.now() < deadline) {
        await sleepWithAbort(pollIntervalMs, options.signal);

        const pollResponse = await fetch(`${options.apiUrl}/auth/device/poll`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ device_code: start.deviceCode }),
            signal: options.signal ?? AbortSignal.timeout(10_000),
        });

        const payload: unknown = await pollResponse.json().catch(() => null);

        if (!pollResponse.ok) {
            if (pollResponse.status === 404 || pollResponse.status === 403) {
                throw new Error('Device code login is not enabled for this Dexto server');
            }
            if (pollResponse.status === 429) {
                pollIntervalMs += 5_000;
                continue;
            }

            const errorCode = parseErrorCode(payload);
            if (errorCode) {
                if (errorCode === 'authorization_pending') {
                    continue;
                }
                if (errorCode === 'slow_down') {
                    pollIntervalMs += 5_000;
                    continue;
                }
                if (errorCode === 'expired_token') {
                    throw new Error('Device login expired. Please restart login.');
                }
                if (errorCode === 'access_denied') {
                    throw new Error('Device login was denied.');
                }
                throw new Error(`Device login failed: ${errorCode}`);
            }

            throw new Error(`Device login polling failed with status ${pollResponse.status}`);
        }

        const tokenResponse = parseDevicePollTokenResponse(payload);
        if (!tokenResponse) {
            const errorCode = parseErrorCode(payload);
            if (errorCode === 'authorization_pending') {
                continue;
            }
            if (errorCode === 'slow_down') {
                pollIntervalMs += 5_000;
                continue;
            }
            if (errorCode === 'expired_token') {
                throw new Error('Device login expired. Please restart login.');
            }
            if (errorCode === 'access_denied') {
                throw new Error('Device login was denied.');
            }
            continue;
        }

        const computedExpiresIn =
            tokenResponse.expiresIn ??
            (tokenResponse.expiresAt
                ? Math.max(0, tokenResponse.expiresAt - Date.now() / 1000)
                : undefined);
        const user = await fetchUserFromToken(tokenResponse.accessToken);

        return {
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken ?? undefined,
            expiresIn: computedExpiresIn,
            user,
        };
    }

    throw new Error('Device login timed out. Please restart login.');
}
