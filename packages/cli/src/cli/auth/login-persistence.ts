import { type DextoApiKeyProvisionStatus, ensureDextoApiKeyForAuthToken } from './dexto-api-key.js';
import type { OAuthResult } from './oauth.js';
import { loadAuth, storeAuth, type AuthConfig } from './service.js';
import type { DeviceApiKeyLoginResult } from './types.js';
import { DEXTO_PLATFORM_URL } from './constants.js';

export interface PersistOAuthLoginOptions {
    onProvisionStatus?: ((status: DextoApiKeyProvisionStatus) => void) | undefined;
}

export interface PersistedLoginResult {
    email?: string | undefined;
    userId?: string | undefined;
    keyId?: string | undefined;
    hasDextoApiKey: boolean;
}

function isSameAuthenticatedUser(
    existingAuth: AuthConfig | null,
    user: OAuthResult['user']
): boolean {
    if (!existingAuth || !user) {
        return false;
    }

    if (existingAuth.userId && user.id) {
        return existingAuth.userId === user.id;
    }

    if (existingAuth.email && user.email) {
        return existingAuth.email.toLowerCase() === user.email.toLowerCase();
    }

    return false;
}

function getPreservedDextoApiKey(
    existingAuth: AuthConfig | null,
    user: OAuthResult['user']
): Pick<
    AuthConfig,
    'dextoApiKey' | 'dextoKeyId' | 'dextoApiKeySource' | 'dextoPlatformUrl'
> | null {
    if (!existingAuth?.dextoApiKey || !isSameAuthenticatedUser(existingAuth, user)) {
        return null;
    }
    const keyOrigin = existingAuth.dextoPlatformUrl ?? 'https://app.dexto.ai';
    if (new URL(keyOrigin).origin !== new URL(DEXTO_PLATFORM_URL).origin) return null;

    const isProvisionedKey =
        existingAuth.dextoApiKeySource === 'provisioned' ||
        (existingAuth.dextoApiKeySource === undefined && Boolean(existingAuth.dextoKeyId));

    if (!isProvisionedKey) {
        return null;
    }

    return {
        dextoApiKey: existingAuth.dextoApiKey,
        ...(existingAuth.dextoKeyId ? { dextoKeyId: existingAuth.dextoKeyId } : {}),
        dextoApiKeySource: 'provisioned',
        ...(existingAuth.dextoPlatformUrl
            ? { dextoPlatformUrl: existingAuth.dextoPlatformUrl }
            : {}),
    };
}

export async function persistOAuthLoginResult(
    result: OAuthResult,
    options: PersistOAuthLoginOptions = {}
): Promise<PersistedLoginResult> {
    const existingAuth = await loadAuth();
    const expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;
    const preservedDextoApiKey = getPreservedDextoApiKey(existingAuth, result.user);

    await storeAuth({
        token: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.user?.id,
        email: result.user?.email,
        createdAt: Date.now(),
        expiresAt,
        ...(preservedDextoApiKey ?? {}),
    });

    const ensured = await ensureDextoApiKeyForAuthToken(result.accessToken, {
        onStatus: options.onProvisionStatus,
    });

    return {
        email: result.user?.email,
        userId: result.user?.id,
        keyId: ensured?.keyId ?? preservedDextoApiKey?.dextoKeyId ?? undefined,
        hasDextoApiKey: Boolean(ensured?.dextoApiKey ?? preservedDextoApiKey?.dextoApiKey),
    };
}

export async function persistDeviceApiKeyLoginResult(
    result: DeviceApiKeyLoginResult,
    platformUrl: string = DEXTO_PLATFORM_URL
): Promise<PersistedLoginResult> {
    await storeAuth({
        dextoApiKey: result.dextoApiKey,
        dextoKeyId: result.dextoKeyId,
        dextoApiKeySource: 'provisioned',
        dextoPlatformUrl: new URL(platformUrl).origin,
        createdAt: Date.now(),
    });

    return {
        keyId: result.dextoKeyId,
        hasDextoApiKey: true,
    };
}
