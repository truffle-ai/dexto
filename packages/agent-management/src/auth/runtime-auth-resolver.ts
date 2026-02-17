import type {
    LlmAuthResolver,
    LlmRuntimeAuthOverrides,
    ResolveLlmRuntimeAuthInput,
} from '@dexto/core';

import {
    getDefaultLlmAuthProfileIdSync,
    getLlmAuthProfileSync,
    upsertLlmAuthProfile,
    type LlmAuthProfile,
    type LlmAuthCredential,
} from './llm-profiles.js';

const OAUTH_DUMMY_KEY = 'dexto-oauth-dummy-key';
const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';

type RefreshLock = {
    inFlight: Promise<void> | null;
};

function createRefreshLock(): RefreshLock {
    return { inFlight: null };
}

const refreshLocksByProfileId = new Map<string, RefreshLock>();

function getLock(profileId: string): RefreshLock {
    const existing = refreshLocksByProfileId.get(profileId);
    if (existing) return existing;
    const created = createRefreshLock();
    refreshLocksByProfileId.set(profileId, created);
    return created;
}

function removeAuthHeader(headers: Headers): void {
    headers.delete('authorization');
    headers.delete('Authorization');
}

function upsertAuthHeader(headers: Headers, value: string): void {
    headers.set('authorization', value);
}

function mergeHeaders(initHeaders: RequestInit['headers']): Headers {
    const headers = new Headers();
    if (!initHeaders) return headers;

    if (initHeaders instanceof Headers) {
        initHeaders.forEach((value, key) => headers.set(key, value));
        return headers;
    }

    if (Array.isArray(initHeaders)) {
        for (const [key, value] of initHeaders) {
            if (value !== undefined) headers.set(key, String(value));
        }
        return headers;
    }

    for (const [key, value] of Object.entries(initHeaders)) {
        if (value !== undefined) headers.set(key, String(value));
    }
    return headers;
}

function isOauthCredential(
    cred: LlmAuthCredential
): cred is Extract<LlmAuthCredential, { type: 'oauth' }> {
    return cred.type === 'oauth';
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const json = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function extractChatGptAccountIdFromClaims(claims: Record<string, unknown>): string | null {
    const direct = claims['chatgpt_account_id'];
    if (typeof direct === 'string' && direct.trim()) return direct;

    const auth = claims['https://api.openai.com/auth'];
    if (typeof auth === 'object' && auth !== null) {
        const maybe = (auth as Record<string, unknown>)['chatgpt_account_id'];
        if (typeof maybe === 'string' && maybe.trim()) return maybe;
    }

    const orgs = claims['organizations'];
    if (Array.isArray(orgs) && orgs.length > 0) {
        const first = orgs[0];
        if (typeof first === 'object' && first !== null) {
            const id = (first as Record<string, unknown>)['id'];
            if (typeof id === 'string' && id.trim()) return id;
        }
    }

    return null;
}

function extractChatGptAccountId(tokens: {
    id_token?: string;
    access_token?: string;
}): string | null {
    if (tokens.id_token) {
        const claims = decodeJwtClaims(tokens.id_token);
        if (claims) {
            const id = extractChatGptAccountIdFromClaims(claims);
            if (id) return id;
        }
    }
    if (tokens.access_token) {
        const claims = decodeJwtClaims(tokens.access_token);
        if (claims) {
            const id = extractChatGptAccountIdFromClaims(claims);
            if (id) return id;
        }
    }
    return null;
}

function toExpiresAt(expiresIn: number): number {
    // Heuristic: duration seconds are small; epoch ms is ~1.7e12.
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return Date.now();
    if (expiresIn < 10_000_000_000) {
        return Date.now() + expiresIn * 1000;
    }
    return expiresIn;
}

function normalizeAnthropicBaseUrl(url: string): string {
    const trimmed = url.trim().replace(/\/$/, '');
    if (!trimmed) return trimmed;
    if (trimmed.endsWith('/v1')) return trimmed;
    return `${trimmed}/v1`;
}

async function refreshOpenAiOauthTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    accountId: string | null;
}> {
    const clientId = process.env.DEXTO_OPENAI_CODEX_OAUTH_CLIENT_ID?.trim();
    if (!clientId) {
        throw new Error('Missing DEXTO_OPENAI_CODEX_OAUTH_CLIENT_ID');
    }

    const response = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
            `OpenAI OAuth refresh failed (${response.status}): ${text || response.statusText}`
        );
    }

    const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        id_token?: string;
    };

    if (!data.access_token) {
        throw new Error('OpenAI OAuth refresh response missing access_token');
    }

    const expiresInSec =
        typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
    const accountId = extractChatGptAccountId({
        id_token: data.id_token,
        access_token: data.access_token,
    });

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        expiresAt: Date.now() + expiresInSec * 1000,
        accountId,
    };
}

async function refreshMiniMaxPortalOauthTokens(params: {
    region: 'cn' | 'global';
    refreshToken: string;
}): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    resourceUrl?: string;
    notificationMessage?: string;
}> {
    const clientId = process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID?.trim();
    if (!clientId) {
        throw new Error('Missing DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID');
    }

    const baseUrl = params.region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
    const response = await fetch(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: params.refreshToken,
            client_id: clientId,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text().catch(() => '');
    let payload: unknown;
    try {
        payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(
            `MiniMax OAuth refresh failed (${response.status}): ${text || response.statusText}`
        );
    }

    const data = payload as {
        status?: string;
        access_token?: string | null;
        refresh_token?: string | null;
        expired_in?: number | null;
        resource_url?: string | null;
        notification_message?: string | null;
    };

    if (data?.status !== 'success') {
        throw new Error('MiniMax OAuth refresh returned non-success status');
    }

    if (!data.access_token || !data.refresh_token || !data.expired_in) {
        throw new Error('MiniMax OAuth refresh response missing required fields');
    }

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: toExpiresAt(data.expired_in),
        ...(data.resource_url ? { resourceUrl: data.resource_url } : {}),
        ...(data.notification_message ? { notificationMessage: data.notification_message } : {}),
    };
}

async function refreshOauthProfileIfNeeded(profile: LlmAuthProfile): Promise<LlmAuthProfile> {
    if (!isOauthCredential(profile.credential)) return profile;

    const now = Date.now();
    const safetyWindowMs = 30_000;
    if (profile.credential.expiresAt > now + safetyWindowMs) {
        return profile;
    }

    const lock = getLock(profile.profileId);
    if (lock.inFlight) {
        await lock.inFlight;
        return getLlmAuthProfileSync(profile.profileId) ?? profile;
    }

    lock.inFlight = (async () => {
        const latest = getLlmAuthProfileSync(profile.profileId) ?? profile;
        if (!isOauthCredential(latest.credential)) return;

        if (latest.credential.expiresAt > Date.now() + safetyWindowMs) return;

        if (latest.providerId === 'openai' && latest.methodId === 'oauth_codex') {
            const refreshed = await refreshOpenAiOauthTokens(latest.credential.refreshToken);
            const nextCred: Extract<LlmAuthCredential, { type: 'oauth' }> = {
                ...latest.credential,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                expiresAt: refreshed.expiresAt,
                ...(refreshed.accountId
                    ? {
                          metadata: {
                              ...(latest.credential.metadata ?? {}),
                              accountId: refreshed.accountId,
                          },
                      }
                    : {}),
            };
            await upsertLlmAuthProfile({
                profileId: latest.profileId,
                providerId: latest.providerId,
                methodId: latest.methodId,
                label: latest.label,
                credential: nextCred,
            });
            return;
        }

        if (
            latest.providerId.startsWith('minimax') &&
            (latest.methodId === 'portal_oauth_global' || latest.methodId === 'portal_oauth_cn')
        ) {
            const region =
                (latest.credential.metadata?.region as 'cn' | 'global' | undefined) ??
                (latest.methodId === 'portal_oauth_cn' ? 'cn' : 'global');

            const refreshed = await refreshMiniMaxPortalOauthTokens({
                region,
                refreshToken: latest.credential.refreshToken,
            });

            const nextCred: Extract<LlmAuthCredential, { type: 'oauth' }> = {
                ...latest.credential,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                expiresAt: refreshed.expiresAt,
                metadata: {
                    ...(latest.credential.metadata ?? {}),
                    region,
                    ...(refreshed.resourceUrl ? { resourceUrl: refreshed.resourceUrl } : {}),
                },
            };

            await upsertLlmAuthProfile({
                profileId: latest.profileId,
                providerId: latest.providerId,
                methodId: latest.methodId,
                label: latest.label,
                credential: nextCred,
            });
            return;
        }

        // Unknown OAuth provider/method: no refresh implemented yet.
    })().finally(() => {
        lock.inFlight = null;
    });

    await lock.inFlight;
    return getLlmAuthProfileSync(profile.profileId) ?? profile;
}

function buildOAuthFetchWrapper(params: {
    profileId: string;
    headerKind: 'authorization_bearer' | 'x_api_key';
    extraHeaders?: Record<string, string> | undefined;
}): typeof fetch {
    return async (requestInput, init) => {
        const headers = mergeHeaders(init?.headers);

        // Remove any SDK-injected auth header (dummy key).
        removeAuthHeader(headers);
        headers.delete('x-api-key');
        headers.delete('X-API-Key');

        const profile = getLlmAuthProfileSync(params.profileId);
        if (!profile || profile.credential.type !== 'oauth') {
            return fetch(requestInput, { ...init, headers });
        }

        const refreshed = await refreshOauthProfileIfNeeded(profile);
        const cred = refreshed.credential;
        if (cred.type !== 'oauth') {
            return fetch(requestInput, { ...init, headers });
        }

        if (params.headerKind === 'authorization_bearer') {
            upsertAuthHeader(headers, `Bearer ${cred.accessToken}`);
        } else {
            headers.set('x-api-key', cred.accessToken);
        }

        if (params.extraHeaders) {
            for (const [key, value] of Object.entries(params.extraHeaders)) {
                headers.set(key, value);
            }
        }

        // Provider-specific metadata headers (best-effort)
        if (refreshed.providerId === 'openai' && refreshed.methodId === 'oauth_codex') {
            const accountId = cred.metadata?.accountId;
            if (accountId) {
                headers.set('ChatGPT-Account-Id', accountId);
            }
        }

        return fetch(requestInput, { ...init, headers });
    };
}

export function createDefaultLlmAuthResolver(): LlmAuthResolver {
    return {
        resolveRuntimeAuth(input: ResolveLlmRuntimeAuthInput): LlmRuntimeAuthOverrides | null {
            const defaultProfileId = getDefaultLlmAuthProfileIdSync(input.provider);
            if (!defaultProfileId) return null;

            const profile = getLlmAuthProfileSync(defaultProfileId);
            if (!profile) return null;

            // Basic credential types
            if (profile.credential.type === 'api_key') {
                return { apiKey: profile.credential.key };
            }
            if (profile.credential.type === 'token') {
                return { apiKey: profile.credential.token };
            }

            // OAuth methods (runtime-affecting)
            if (profile.credential.type === 'oauth') {
                if (profile.providerId === 'openai' && profile.methodId === 'oauth_codex') {
                    const baseURL = 'https://chatgpt.com/backend-api/codex';
                    return {
                        apiKey: OAUTH_DUMMY_KEY,
                        baseURL,
                        fetch: buildOAuthFetchWrapper({
                            profileId: profile.profileId,
                            headerKind: 'authorization_bearer',
                        }),
                    };
                }

                if (
                    profile.providerId.startsWith('minimax') &&
                    (profile.methodId === 'portal_oauth_global' ||
                        profile.methodId === 'portal_oauth_cn')
                ) {
                    const region =
                        (profile.credential.metadata?.region as 'cn' | 'global' | undefined) ??
                        (profile.methodId === 'portal_oauth_cn' ? 'cn' : 'global');

                    const fallbackResourceUrl =
                        region === 'cn'
                            ? 'https://api.minimaxi.com/anthropic/v1'
                            : 'https://api.minimax.io/anthropic/v1';

                    const resourceUrl =
                        profile.credential.metadata?.resourceUrl?.trim() || fallbackResourceUrl;

                    return {
                        apiKey: OAUTH_DUMMY_KEY,
                        baseURL: normalizeAnthropicBaseUrl(resourceUrl),
                        fetch: buildOAuthFetchWrapper({
                            profileId: profile.profileId,
                            headerKind: 'x_api_key',
                        }),
                    };
                }

                // Default behavior for unknown OAuth provider/method: try bearer auth.
                return {
                    apiKey: OAUTH_DUMMY_KEY,
                    fetch: buildOAuthFetchWrapper({
                        profileId: profile.profileId,
                        headerKind: 'authorization_bearer',
                    }),
                };
            }

            return null;
        },
    };
}
