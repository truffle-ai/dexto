import { isMetadataHost } from '@dexto/core';

/**
 * Why a webhook URL is not accepted, or undefined when it is fine.
 *
 * Webhook events carry prompts and model output, so the target must be a plain http(s) URL
 * without credentials, and not a cloud metadata address or host name. Names that resolve to a metadata
 * address are caught at delivery time. Loopback and private addresses stay
 * allowed because webhooks to local services are a normal setup.
 */
export function webhookUrlProblem(rawUrl: string): string | undefined {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return 'Invalid URL format';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Webhook URL must use http or https';
    }
    if (parsed.username || parsed.password) {
        return 'Webhook URL must not contain credentials';
    }
    if (isMetadataHost(parsed.hostname)) {
        return 'Webhook URL must not point at a link-local or metadata address';
    }
    return undefined;
}
