// packages/cli/src/cli/auth/device.ts
// Device code login flow for browserless environments.

import { DextoApiClient, getDextoApiClient } from './api-client.js';
import type { AuthLoginResult } from './types.js';

export interface DeviceLoginPrompt {
    userCode: string;
    verificationUrl: string;
    verificationUrlComplete: string | null;
    expiresIn: number;
}

export interface DeviceLoginOptionsInput {
    apiUrl?: string;
    signal?: AbortSignal;
    onPrompt?: ((prompt: DeviceLoginPrompt) => void | Promise<void>) | undefined;
}

interface DeviceLoginOptions {
    apiUrl?: string | undefined;
    signal: AbortSignal | null;
    onPrompt: (prompt: DeviceLoginPrompt) => void | Promise<void>;
}

function resolveDeviceLoginOptions(options: DeviceLoginOptionsInput): DeviceLoginOptions {
    return {
        apiUrl: options.apiUrl,
        signal: options.signal ?? null,
        onPrompt: options.onPrompt ?? (() => undefined),
    };
}

function getAuthClient(apiUrl: string | undefined): DextoApiClient {
    return apiUrl ? new DextoApiClient(apiUrl) : getDextoApiClient();
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

export async function performDeviceCodeLogin(
    optionsInput: DeviceLoginOptionsInput = {}
): Promise<AuthLoginResult> {
    const options = resolveDeviceLoginOptions(optionsInput);
    const authClient = getAuthClient(options.apiUrl);

    const start = await authClient.startDeviceCodeLogin('dexto-cli', {
        signal: options.signal ?? undefined,
    });

    await options.onPrompt({
        userCode: start.userCode,
        verificationUrl: start.verificationUrl,
        verificationUrlComplete: start.verificationUrlComplete,
        expiresIn: start.expiresIn,
    });

    const deadline = Date.now() + start.expiresIn * 1000;
    let pollIntervalMs = Math.max(1, Math.floor(start.interval)) * 1000;

    while (Date.now() < deadline) {
        await sleepWithAbort(pollIntervalMs, options.signal);

        const pollResult = await authClient.pollDeviceCodeLogin(start.deviceCode, {
            signal: options.signal ?? undefined,
        });

        if (pollResult.status === 'pending') {
            continue;
        }

        if (pollResult.status === 'slowDown') {
            pollIntervalMs += 5_000;
            continue;
        }

        if (pollResult.status === 'expired') {
            throw new Error('Device login expired. Please restart login.');
        }

        if (pollResult.status === 'denied') {
            throw new Error('Device login was denied.');
        }

        const tokenResponse = pollResult.token;
        const computedExpiresIn =
            tokenResponse.expiresIn ??
            (tokenResponse.expiresAt
                ? Math.max(0, tokenResponse.expiresAt - Date.now() / 1000)
                : undefined);
        const user = await authClient.fetchSupabaseUser(tokenResponse.accessToken, {
            signal: options.signal ?? undefined,
        });

        return {
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken ?? undefined,
            expiresIn: computedExpiresIn,
            user,
        };
    }

    throw new Error('Device login timed out. Please restart login.');
}
