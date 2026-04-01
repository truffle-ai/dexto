/**
 * Dexto Authentication Utilities
 *
 * Provides functions to check dexto authentication status.
 * Used by both CLI and server to determine if user can use dexto features.
 */

import { existsSync, promises as fs } from 'fs';
import { z } from 'zod';
import { getDextoGlobalPath } from '@dexto/core';

const AUTH_CONFIG_FILE = 'auth.json';

/**
 * Minimal schema for checking auth status.
 * We only need to verify token exists and hasn't expired.
 */
const AuthConfigSchema = z
    .object({
        token: z.string().min(1).optional(),
        refreshToken: z.string().optional(),
        expiresAt: z.number().optional(),
        createdAt: z.number().optional(),
        dextoApiKey: z.string().optional(),
        dextoKeyId: z.string().optional(),
        dextoApiKeySource: z.enum(['provisioned', 'user-supplied']).optional(),
    })
    .refine((data) => data.token || data.dextoApiKey, {
        message: 'Either token or dextoApiKey is required',
    });

type AuthConfig = z.output<typeof AuthConfigSchema>;

async function loadAuthConfig(): Promise<AuthConfig | null> {
    const authPath = getDextoGlobalPath('', AUTH_CONFIG_FILE);

    if (!existsSync(authPath)) {
        return null;
    }

    try {
        const content = await fs.readFile(authPath, 'utf-8');
        const config = JSON.parse(content);
        const validated = AuthConfigSchema.safeParse(config);

        if (!validated.success) {
            return null;
        }

        const auth = validated.data;

        // Match CLI semantics more closely: an expired access token can still back
        // a usable login when we also have a refresh token or a persisted Dexto API key.
        if (auth.expiresAt && auth.expiresAt < Date.now()) {
            if (!auth.refreshToken && !auth.dextoApiKey) {
                return null;
            }
        }

        return auth;
    } catch {
        return null;
    }
}

/**
 * Check if user is authenticated with Dexto.
 * Returns true if auth.json exists with valid (non-expired) token.
 */
export async function isDextoAuthenticated(): Promise<boolean> {
    return (await loadAuthConfig()) !== null;
}

/**
 * Get the dexto API key from auth config or environment.
 */
export async function getDextoApiKeyFromAuth(): Promise<string | null> {
    const auth = await loadAuthConfig();
    if (auth?.dextoApiKey?.trim()) {
        const apiKey = auth.dextoApiKey.trim();
        process.env.DEXTO_API_KEY = apiKey;
        return apiKey;
    }

    if (process.env.DEXTO_API_KEY?.trim()) {
        return process.env.DEXTO_API_KEY;
    }

    return null;
}

/**
 * Check if user can use Dexto provider.
 * Requires BOTH:
 * 1. User is authenticated (valid auth token)
 * 2. Has DEXTO_API_KEY (from auth config or environment)
 */
export async function canUseDextoProvider(): Promise<boolean> {
    const authenticated = await isDextoAuthenticated();
    if (!authenticated) return false;

    const apiKey = await getDextoApiKeyFromAuth();
    if (!apiKey) return false;

    return true;
}
