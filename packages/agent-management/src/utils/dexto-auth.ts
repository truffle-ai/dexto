/**
 * Dexto Authentication Utilities
 *
 * Provides functions to check dexto authentication status.
 * Used by both CLI and server to determine if user can use dexto features.
 */

import { existsSync, promises as fs } from 'fs';
import { z } from 'zod';
import { getDextoGlobalPath } from '@dexto/core';

const AUTH_DIR = 'auth';
const AUTH_CONFIG_FILE = 'dexto.json';

/**
 * Minimal schema for checking auth status.
 * We only need to verify token exists and hasn't expired.
 */
const AuthConfigSchema = z.object({
    token: z.string().min(1),
    expiresAt: z.number().optional(),
    dextoApiKey: z.string().optional(),
});

/**
 * Check if user is authenticated with Dexto.
 * Returns true if dexto auth file exists with valid (non-expired) token.
 */
export async function isDextoAuthenticated(): Promise<boolean> {
    const authPath = getDextoGlobalPath(AUTH_DIR, AUTH_CONFIG_FILE);

    if (!existsSync(authPath)) {
        return false;
    }

    try {
        const content = await fs.readFile(authPath, 'utf-8');
        const config = JSON.parse(content);
        const validated = AuthConfigSchema.safeParse(config);

        if (!validated.success) {
            return false;
        }

        // Check if token has expired
        if (validated.data.expiresAt && validated.data.expiresAt < Date.now()) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * Get the dexto API key from auth config or environment.
 */
export async function getDextoApiKeyFromAuth(): Promise<string | null> {
    // Check environment variable first
    if (process.env.DEXTO_API_KEY) {
        return process.env.DEXTO_API_KEY;
    }

    // Check auth config
    const authPath = getDextoGlobalPath(AUTH_DIR, AUTH_CONFIG_FILE);

    if (!existsSync(authPath)) {
        return null;
    }

    try {
        const content = await fs.readFile(authPath, 'utf-8');
        const config = JSON.parse(content);
        return config.dextoApiKey || null;
    } catch {
        return null;
    }
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
