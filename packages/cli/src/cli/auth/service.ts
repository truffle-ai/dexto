// packages/cli/src/cli/auth/service.ts
// Auth storage, token management, and refresh logic

import chalk from 'chalk';
import { existsSync, promises as fs } from 'fs';
import { z } from 'zod';
import { getDextoGlobalPath, logger } from '@dexto/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

const AUTH_CONFIG_FILE = 'auth.json';

export interface AuthConfig {
    /** Supabase access token from OAuth login (optional if using --api-key) */
    token?: string | undefined;
    refreshToken?: string | undefined;
    userId?: string | undefined;
    email?: string | undefined;
    expiresAt?: number | undefined;
    createdAt: number;
    /** Dexto API key for gateway access (from --api-key or provisioned after OAuth) */
    dextoApiKey?: string | undefined;
    dextoKeyId?: string | undefined;
    dextoApiKeySource?: 'provisioned' | 'user-supplied' | undefined;
}

const AuthConfigSchema = z
    .object({
        token: z.string().min(1).optional(),
        refreshToken: z.string().optional(),
        userId: z.string().optional(),
        email: z.string().email().optional(),
        expiresAt: z.number().optional(),
        createdAt: z.number(),
        dextoApiKey: z.string().optional(),
        dextoKeyId: z.string().optional(),
        dextoApiKeySource: z.enum(['provisioned', 'user-supplied']).optional(),
    })
    .refine((data) => data.token || data.dextoApiKey, {
        message: 'Either token (from OAuth) or dextoApiKey (from --api-key) is required',
    });

export async function storeAuth(config: AuthConfig): Promise<void> {
    const authPath = getDextoGlobalPath('', AUTH_CONFIG_FILE);
    const dextoDir = getDextoGlobalPath('', '');

    await fs.mkdir(dextoDir, { recursive: true });
    await fs.writeFile(authPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    logger.debug(`Stored auth config at: ${authPath}`);
}

export async function loadAuth(): Promise<AuthConfig | null> {
    const authPath = getDextoGlobalPath('', AUTH_CONFIG_FILE);

    if (!existsSync(authPath)) {
        return null;
    }

    try {
        const content = await fs.readFile(authPath, 'utf-8');
        const config = JSON.parse(content);

        const validated = AuthConfigSchema.parse(config);

        if (validated.expiresAt && validated.expiresAt < Date.now()) {
            // Only remove auth if there's no refresh token available
            // If refresh token exists, return the expired auth and let getAuthToken() handle refresh
            if (!validated.refreshToken) {
                await removeAuth();
                return null;
            }
        }

        return validated;
    } catch (error) {
        logger.warn(`Invalid auth config, removing: ${error}`);
        await removeAuth();
        return null;
    }
}

export async function removeAuth(): Promise<void> {
    const authPath = getDextoGlobalPath('', AUTH_CONFIG_FILE);

    if (existsSync(authPath)) {
        await fs.unlink(authPath);
        logger.debug(`Removed auth config from: ${authPath}`);
    }
}

export async function isAuthenticated(): Promise<boolean> {
    const auth = await loadAuth();
    return auth !== null;
}

export async function getAuthToken(): Promise<string | null> {
    const auth = await loadAuth();

    if (!auth) {
        return null;
    }

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const isExpiringSoon = auth.expiresAt && auth.expiresAt < now + fiveMinutes;

    if (!isExpiringSoon) {
        return auth.token ?? null;
    }

    if (!auth.refreshToken) {
        logger.debug('Token expired but no refresh token available');
        await removeAuth();
        return null;
    }

    logger.debug('Access token expired or expiring soon, refreshing...');
    console.log(chalk.cyan('🔄 Access token expiring soon, refreshing...'));

    const refreshResult = await refreshAccessToken(auth.refreshToken);

    if (!refreshResult) {
        logger.debug('Token refresh failed, removing auth');
        console.log(chalk.red('❌ Token refresh failed. Please login again.'));
        await removeAuth();
        return null;
    }

    const newExpiresAt = Date.now() + refreshResult.expiresIn * 1000;
    await storeAuth({
        ...auth,
        token: refreshResult.accessToken,
        refreshToken: refreshResult.refreshToken,
        expiresAt: newExpiresAt,
    });

    logger.debug('Token refreshed successfully');
    console.log(chalk.green('✅ Access token refreshed successfully'));
    return refreshResult.accessToken;
}

export async function getDextoApiKey(): Promise<string | null> {
    // Explicit env var takes priority (for CI, testing, account override)
    if (process.env.DEXTO_API_KEY?.trim()) {
        return process.env.DEXTO_API_KEY;
    }
    // Fall back to auth.json (from `dexto login`)
    const auth = await loadAuth();
    return auth?.dextoApiKey || null;
}

async function refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
} | null> {
    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
                refresh_token: refreshToken,
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            logger.debug(`Token refresh failed: ${response.status}`);
            return null;
        }

        const data = await response.json();

        if (!data.access_token || !data.refresh_token) {
            logger.debug('Token refresh response missing required tokens');
            return null;
        }

        logger.debug('Successfully refreshed access token');
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in || 3600,
        };
    } catch (error) {
        logger.debug(
            `Token refresh error: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

export function getAuthFilePath(): string {
    return getDextoGlobalPath('', AUTH_CONFIG_FILE);
}
