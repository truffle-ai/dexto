import { openBrowserUrl } from './browser-launch.js';
import { DEXTO_CREDITS_URL } from './constants.js';

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

export async function openDextoBillingPage(options: { url?: string | undefined }): Promise<void> {
    await openBrowserUrl(options.url ?? DEXTO_CREDITS_URL);
}
