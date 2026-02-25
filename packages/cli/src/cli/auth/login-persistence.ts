import { type DextoApiKeyProvisionStatus, ensureDextoApiKeyForAuthToken } from './dexto-api-key.js';
import type { OAuthResult } from './oauth.js';
import { storeAuth } from './service.js';

export interface PersistOAuthLoginOptions {
    onProvisionStatus?: ((status: DextoApiKeyProvisionStatus) => void) | undefined;
}

export interface PersistedLoginResult {
    email?: string | undefined;
    userId?: string | undefined;
    keyId?: string | undefined;
    hasDextoApiKey: boolean;
}

export async function persistOAuthLoginResult(
    result: OAuthResult,
    options: PersistOAuthLoginOptions = {}
): Promise<PersistedLoginResult> {
    const expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;

    await storeAuth({
        token: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.user?.id,
        email: result.user?.email,
        createdAt: Date.now(),
        expiresAt,
    });

    const ensured = await ensureDextoApiKeyForAuthToken(result.accessToken, {
        onStatus: options.onProvisionStatus,
    });

    return {
        email: result.user?.email,
        userId: result.user?.id,
        keyId: ensured?.keyId ?? undefined,
        hasDextoApiKey: Boolean(ensured?.dextoApiKey),
    };
}
