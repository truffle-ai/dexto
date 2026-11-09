const METADATA_HOSTNAMES = new Set(['metadata.google.internal', '[fd00:ec2::254]']);

/**
 * Why a webhook URL is not accepted, or undefined when it is fine.
 *
 * Webhook events carry prompts and model output, so the target must be a plain http(s) URL
 * without credentials, and not a cloud metadata address. Loopback and private addresses stay
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
    if (parsed.hostname.startsWith('169.254.') || METADATA_HOSTNAMES.has(parsed.hostname)) {
        return 'Webhook URL must not point at a link-local or metadata address';
    }
    return undefined;
}
