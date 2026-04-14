import type { BillingCheckoutSessionResponse } from './api-client.js';
import { getDextoApiClient } from './api-client.js';
import { openBrowserUrl } from './browser-launch.js';
import { DEXTO_CREDITS_URL } from './constants.js';
import { getAuthTokenQuietly } from './service.js';

function notLoggedInError(): Error {
    return new Error('Not logged in to Dexto');
}

export function buildDextoBillingUrl(options: {
    creditsUsd?: number | undefined;
    baseUrl?: string | undefined;
}): string {
    const url = new URL(options.baseUrl ?? DEXTO_CREDITS_URL);

    if (typeof options.creditsUsd === 'number' && Number.isFinite(options.creditsUsd)) {
        url.searchParams.set('credits_usd', String(options.creditsUsd));
    }

    return url.toString();
}

export async function getBillingBalanceForCurrentLogin(): Promise<number | null> {
    const authToken = await getAuthTokenQuietly();
    if (!authToken) {
        return null;
    }

    const response = await getDextoApiClient().getBillingBalance(authToken, {});
    return response.creditsUsd;
}

export async function createBillingCheckoutForCurrentLogin(options: {
    creditsUsd: number;
    returnUrl?: string | undefined;
}): Promise<BillingCheckoutSessionResponse> {
    const authToken = await getAuthTokenQuietly();
    if (!authToken) {
        throw notLoggedInError();
    }

    return getDextoApiClient().createBillingCheckoutSession(authToken, {
        ...options,
        returnUrl: options.returnUrl ?? DEXTO_CREDITS_URL,
    });
}

export async function openDextoBillingPage(options: { url?: string | undefined }): Promise<void> {
    await openBrowserUrl(options.url ?? DEXTO_CREDITS_URL);
}
