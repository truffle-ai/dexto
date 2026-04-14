import type { BillingCheckoutSessionResponse } from './api-client.js';
import { getDextoApiClient } from './api-client.js';
import { openBrowserUrl } from './browser-launch.js';
import { DEXTO_CREDITS_URL } from './constants.js';
import { getAuthTokenQuietly } from './service.js';

function notLoggedInError(): Error {
    return new Error('Not logged in to Dexto');
}

export async function getBillingBalanceForCurrentLogin(): Promise<number | null> {
    const authToken = await getAuthTokenQuietly();
    if (!authToken) {
        return null;
    }

    const response = await getDextoApiClient().getBillingBalance(authToken);
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

export async function openDextoBillingPage(url: string = DEXTO_CREDITS_URL): Promise<void> {
    await openBrowserUrl(url);
}
