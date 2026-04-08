import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { LlmAuthCredential, LlmAuthProfile } from '../llm-profiles.js';
import type { OAuthRuntimeAuthProjection, StartedOAuthFlow } from '../provider-auth-definitions.js';
import { formatOauthHttpError } from './shared.js';

export type MiniMaxRegion = 'cn' | 'global';

const MINIMAX_PORTAL_CLIENT_ID_ENV = 'DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID';
const MINIMAX_SCOPE = 'group_id profile model.completion';
const MINIMAX_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:user_code';

type OAuthCredential = Extract<LlmAuthCredential, { type: 'oauth' }>;

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
    if (!Number.isFinite(expiredIn) || expiredIn <= 0) return Date.now();
    if (expiredIn < 10_000_000_000) {
        return Date.now() + expiredIn * 1000;
    }
    return expiredIn;
}

function normalizeAnthropicBaseUrl(url: string): string {
    const trimmed = url.trim().replace(/\/$/, '');
    if (!trimmed) return trimmed;
    if (trimmed.endsWith('/v1')) return trimmed;
    return `${trimmed}/v1`;
}

function resolveClientId(clientIdFromProfile?: string | undefined): string {
    const fromProfile = clientIdFromProfile?.trim();
    const fromEnv = process.env[MINIMAX_PORTAL_CLIENT_ID_ENV]?.trim();

    if (fromProfile && fromEnv && fromProfile !== fromEnv) {
        throw new Error(
            'MiniMax OAuth clientId mismatch between profile and DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID; reconnect or unset the env var.'
        );
    }

    const clientId = fromProfile || fromEnv;
    if (!clientId) {
        throw new Error(
            'Missing DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID (OAuth app client id required)'
        );
    }

    return clientId;
}

function getFallbackResourceUrl(region: MiniMaxRegion): string {
    return region === 'cn'
        ? 'https://api.minimaxi.com/anthropic/v1'
        : 'https://api.minimax.io/anthropic/v1';
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
    callback(params: {
        onProgress?: ((message: string) => void) | undefined;
    }): Promise<MiniMaxOAuthTokens>;
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
        const text = await formatOauthHttpError(codeRes);
        throw new Error(`MiniMax OAuth init failed: ${text}`);
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

    async function pollToken(params: {
        onProgress?: ((message: string) => void) | undefined;
    }): Promise<MiniMaxOAuthTokens> {
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
                const msg =
                    typeof payload?.base_resp?.status_msg === 'string'
                        ? payload.base_resp.status_msg.trim()
                        : '';
                throw new Error(
                    `MiniMax OAuth token poll failed (${res.status}): ${msg || res.statusText}`
                );
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

            pollIntervalMs = Math.min(Math.round(pollIntervalMs * 1.5), 10_000);
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

            const elapsedSec = Math.round((Date.now() - pollStart) / 1000);
            params.onProgress?.(`Waiting for approval… (${elapsedSec}s)`);
        }

        throw new Error('MiniMax OAuth timed out waiting for authorization');
    }

    return {
        verificationUrl,
        userCode,
        callback: async (params) => await pollToken(params),
    };
}

export async function startMiniMaxPortalOauth(params: {
    region: MiniMaxRegion;
    userAgent?: string | undefined;
}): Promise<StartedOAuthFlow> {
    const clientId = resolveClientId();
    const flow = await loginMiniMaxPortalDeviceCode({
        region: params.region,
        clientId,
    });

    return {
        verificationUrl: flow.verificationUrl,
        userCode: flow.userCode,
        waitForCompletion: async (options) => {
            const tokens = await flow.callback(options);
            return {
                credential: {
                    type: 'oauth',
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresAt: tokens.expiresAt,
                    metadata: {
                        region: params.region,
                        clientId,
                        ...(tokens.resourceUrl ? { resourceUrl: tokens.resourceUrl } : {}),
                    },
                },
                ...(tokens.notificationMessage
                    ? { notificationMessage: tokens.notificationMessage }
                    : {}),
            };
        },
    };
}

export async function refreshMiniMaxPortalOauth(params: {
    profile: LlmAuthProfile;
    credential: OAuthCredential;
    region: MiniMaxRegion;
}): Promise<OAuthCredential> {
    const clientId = resolveClientId(params.credential.metadata?.clientId);
    const response = await fetch(`${getBaseUrl(params.region)}/oauth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: toFormUrlEncoded({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: params.credential.refreshToken,
        }),
        signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text().catch(() => '');
    let payload: {
        status?: string;
        access_token?: string | null;
        refresh_token?: string | null;
        expired_in?: number | null;
        resource_url?: string | null;
        base_resp?: { status_msg?: string | null } | null;
    } | null = null;
    try {
        payload = JSON.parse(text) as {
            status?: string;
            access_token?: string | null;
            refresh_token?: string | null;
            expired_in?: number | null;
            resource_url?: string | null;
            base_resp?: { status_msg?: string | null } | null;
        };
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const message =
            typeof payload?.base_resp?.status_msg === 'string'
                ? payload.base_resp.status_msg.trim()
                : response.statusText;
        throw new Error(`MiniMax OAuth refresh failed (${response.status}): ${message}`);
    }

    if (payload?.status !== 'success') {
        throw new Error('MiniMax OAuth refresh returned non-success status');
    }

    const accessToken = payload.access_token ?? undefined;
    const refreshToken = payload.refresh_token ?? undefined;
    const expiredIn = payload.expired_in ?? undefined;
    if (!accessToken || !refreshToken || !expiredIn) {
        throw new Error('MiniMax OAuth refresh returned incomplete token payload');
    }

    return {
        ...params.credential,
        accessToken,
        refreshToken,
        expiresAt: toExpiresAt(expiredIn),
        metadata: {
            ...(params.credential.metadata ?? {}),
            region: params.region,
            clientId,
            ...(payload.resource_url ? { resourceUrl: payload.resource_url } : {}),
        },
    };
}

export function resolveMiniMaxPortalRuntimeAuth(params: {
    profile: LlmAuthProfile;
    credential: OAuthCredential;
    region: MiniMaxRegion;
}): OAuthRuntimeAuthProjection {
    const resourceUrl =
        params.credential.metadata?.resourceUrl?.trim() || getFallbackResourceUrl(params.region);

    return {
        headerKind: 'x_api_key',
        baseURL: normalizeAnthropicBaseUrl(resourceUrl),
    };
}
