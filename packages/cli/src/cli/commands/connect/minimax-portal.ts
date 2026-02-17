import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type MiniMaxRegion = 'cn' | 'global';

const MINIMAX_SCOPE = 'group_id profile model.completion';
const MINIMAX_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:user_code';

function getBaseUrl(region: MiniMaxRegion): string {
    return region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
}

function toFormUrlEncoded(data: Record<string, string>): string {
    return Object.entries(data)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}

function generatePkce(): { verifier: string; challenge: string; state: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');
    return { verifier, challenge, state };
}

function toExpiresAt(expiredIn: number): number {
    // Heuristic: values in seconds are small; epoch ms is ~1.7e12.
    if (!Number.isFinite(expiredIn) || expiredIn <= 0) return Date.now();
    if (expiredIn < 10_000_000_000) {
        return Date.now() + expiredIn * 1000;
    }
    return expiredIn;
}

export type MiniMaxOAuthTokens = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    resourceUrl?: string | undefined;
    notificationMessage?: string | undefined;
};

export async function loginMiniMaxPortalDeviceCode(options: {
    region: MiniMaxRegion;
    clientId: string;
}): Promise<{
    verificationUrl: string;
    userCode: string;
    callback: (onProgress?: (message: string) => void) => Promise<MiniMaxOAuthTokens>;
}> {
    const baseUrl = getBaseUrl(options.region);
    const endpoints = {
        code: `${baseUrl}/oauth/code`,
        token: `${baseUrl}/oauth/token`,
    };

    const { verifier, challenge, state } = generatePkce();

    const codeRes = await fetch(endpoints.code, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'x-request-id': randomUUID(),
        },
        body: toFormUrlEncoded({
            response_type: 'code',
            client_id: options.clientId,
            scope: MINIMAX_SCOPE,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
        }),
        signal: AbortSignal.timeout(15_000),
    });

    if (!codeRes.ok) {
        const text = await codeRes.text().catch(() => '');
        throw new Error(
            `MiniMax OAuth init failed (${codeRes.status}): ${text || codeRes.statusText}`
        );
    }

    const oauth = (await codeRes.json()) as {
        user_code?: string;
        verification_uri?: string;
        expired_in?: number;
        interval?: number;
        state?: string;
        error?: string;
    };

    if (!oauth.user_code || !oauth.verification_uri) {
        throw new Error(
            oauth.error ??
                'MiniMax OAuth authorization returned incomplete payload (missing user_code or verification_uri)'
        );
    }
    if (oauth.state !== state) {
        throw new Error('MiniMax OAuth state mismatch');
    }

    const verificationUrl = oauth.verification_uri;
    const userCode = oauth.user_code;

    const pollStart = Date.now();
    const expiresAt = toExpiresAt(oauth.expired_in ?? 0);
    let pollIntervalMs = Math.max(oauth.interval ?? 2000, 500);

    let onProgress: ((message: string) => void) | undefined;

    type TokenPollPayload = {
        status?: string;
        access_token?: string | null;
        refresh_token?: string | null;
        expired_in?: number | null;
        resource_url?: string | null;
        notification_message?: string | null;
        base_resp?: { status_msg?: string | null } | null;
    };

    function parsePayload(text: string): TokenPollPayload | null {
        if (!text) return null;
        try {
            const json = JSON.parse(text) as unknown;
            if (typeof json !== 'object' || json === null) return null;
            return json as TokenPollPayload;
        } catch {
            return null;
        }
    }

    async function pollToken(): Promise<MiniMaxOAuthTokens> {
        while (Date.now() < expiresAt) {
            const res = await fetch(endpoints.token, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                },
                body: toFormUrlEncoded({
                    grant_type: MINIMAX_GRANT_TYPE,
                    client_id: options.clientId,
                    user_code: userCode,
                    code_verifier: verifier,
                }),
                signal: AbortSignal.timeout(15_000),
            });

            const text = await res.text().catch(() => '');
            const payload = parsePayload(text);

            if (!res.ok) {
                const msg = payload?.base_resp?.status_msg ?? text ?? res.statusText;
                throw new Error(`MiniMax OAuth token poll failed (${res.status}): ${msg}`);
            }

            const status: string | undefined = payload?.status;
            if (status === 'success') {
                const accessToken = payload?.access_token ?? undefined;
                const refreshToken = payload?.refresh_token ?? undefined;
                const expiredIn = payload?.expired_in ?? undefined;
                if (!accessToken || !refreshToken || !expiredIn) {
                    throw new Error('MiniMax OAuth returned incomplete token payload');
                }
                return {
                    accessToken,
                    refreshToken,
                    expiresAt: toExpiresAt(expiredIn),
                    ...(payload?.resource_url ? { resourceUrl: payload.resource_url } : {}),
                    ...(payload?.notification_message
                        ? { notificationMessage: payload.notification_message }
                        : {}),
                };
            }

            if (status === 'error') {
                throw new Error('MiniMax OAuth returned error status');
            }

            // Pending
            pollIntervalMs = Math.min(Math.round(pollIntervalMs * 1.5), 10_000);
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

            const elapsedSec = Math.round((Date.now() - pollStart) / 1000);
            onProgress?.(`Waiting for approval… (${elapsedSec}s)`);
        }

        throw new Error('MiniMax OAuth timed out waiting for authorization');
    }

    return {
        verificationUrl,
        userCode,
        callback: async (progressCb) => {
            onProgress = progressCb;
            return await pollToken();
        },
    };
}
