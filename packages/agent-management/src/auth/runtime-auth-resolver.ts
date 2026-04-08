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
import {
    getAuthMethodDefinitionForProfile,
    isOauthAuthMethod,
    type OAuthHeaderKind,
} from './provider-auth-definitions.js';

const OAUTH_DUMMY_KEY = 'dexto-oauth-dummy-key';

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

function removeAuthHeader(headers: globalThis.Headers): void {
    headers.delete('authorization');
}

function upsertAuthHeader(headers: globalThis.Headers, value: string): void {
    headers.set('authorization', value);
}

function isRequest(value: unknown): value is globalThis.Request {
    return typeof globalThis.Request !== 'undefined' && value instanceof globalThis.Request;
}

function mergeHeaders(params: {
    requestInput: RequestInfo | URL;
    initHeaders: RequestInit['headers'] | undefined;
}): globalThis.Headers {
    const headers = new globalThis.Headers();

    if (isRequest(params.requestInput)) {
        params.requestInput.headers.forEach((value, key) => headers.set(key, value));
    }

    if (params.initHeaders) {
        const init = new globalThis.Headers(params.initHeaders);
        init.forEach((value, key) => headers.set(key, value));
    }

    return headers;
}

function isOauthCredential(
    cred: LlmAuthCredential
): cred is Extract<LlmAuthCredential, { type: 'oauth' }> {
    return cred.type === 'oauth';
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

        const method = getAuthMethodDefinitionForProfile(latest);
        if (!method || !isOauthAuthMethod(method)) return;

        const nextCredential = await method.oauth.refresh({
            profile: latest,
            credential: latest.credential,
        });

        await upsertLlmAuthProfile({
            profileId: latest.profileId,
            providerId: latest.providerId,
            methodId: latest.methodId,
            label: latest.label,
            credential: nextCredential,
        });
    })().finally(() => {
        lock.inFlight = null;
    });

    await lock.inFlight;
    return getLlmAuthProfileSync(profile.profileId) ?? profile;
}

function buildOAuthFetchWrapper(params: {
    profileId: string;
    headerKind: OAuthHeaderKind;
    extraHeaders?: Record<string, string> | undefined;
}): typeof fetch {
    return async (requestInput, init) => {
        const headers = mergeHeaders({ requestInput, initHeaders: init?.headers });

        removeAuthHeader(headers);
        headers.delete('x-api-key');

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

            if (profile.credential.type === 'api_key') {
                return { apiKey: profile.credential.key };
            }
            if (profile.credential.type === 'token') {
                return { apiKey: profile.credential.token };
            }

            if (profile.credential.type === 'oauth') {
                const method = getAuthMethodDefinitionForProfile(profile);
                if (!method || !isOauthAuthMethod(method)) {
                    return {
                        apiKey: OAUTH_DUMMY_KEY,
                        fetch: buildOAuthFetchWrapper({
                            profileId: profile.profileId,
                            headerKind: 'authorization_bearer',
                        }),
                    };
                }

                const runtimeAuth = method.oauth.resolveRuntimeAuth({
                    profile,
                    credential: profile.credential,
                });

                return {
                    apiKey: OAUTH_DUMMY_KEY,
                    ...(runtimeAuth.baseURL ? { baseURL: runtimeAuth.baseURL } : {}),
                    fetch: buildOAuthFetchWrapper({
                        profileId: profile.profileId,
                        headerKind: runtimeAuth.headerKind,
                        extraHeaders: runtimeAuth.extraHeaders,
                    }),
                };
            }

            return null;
        },
    };
}
