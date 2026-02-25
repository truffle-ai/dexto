import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDextoGlobalDirectory, getDextoEnvPath, logger } from '@dexto/core';
import { getDextoApiClient } from './api-client.js';
import { loadAuth, storeAuth } from './service.js';

export interface EnsureDextoApiKeyOptions {
    onStatus?: ((message: string) => void) | undefined;
}

/**
 * Save DEXTO_API_KEY to the resolved dexto .env path and populate the current
 * process environment immediately.
 */
export async function saveDextoApiKeyToEnv(apiKey: string): Promise<void> {
    const envVar = 'DEXTO_API_KEY';
    const targetEnvPath = getDextoEnvPath();

    await ensureDextoGlobalDirectory();
    await fs.mkdir(path.dirname(targetEnvPath), { recursive: true });

    let envContent = '';
    try {
        envContent = await fs.readFile(targetEnvPath, 'utf-8');
    } catch {
        // File doesn't exist, start fresh
    }

    const lines = envContent.split('\n');
    const keyPattern = new RegExp(`^${envVar}=`);
    const keyIndex = lines.findIndex((line) => keyPattern.test(line));

    if (keyIndex >= 0) {
        lines[keyIndex] = `${envVar}=${apiKey}`;
    } else {
        lines.push(`${envVar}=${apiKey}`);
    }

    await fs.writeFile(targetEnvPath, lines.filter(Boolean).join('\n') + '\n', 'utf-8');
    process.env[envVar] = apiKey;
}

/**
 * Ensure a Dexto API key exists locally for the current auth session.
 *
 * - If a local key exists and validates, it is re-saved to .env (sync) and returned.
 * - If a local key exists but is invalid, it is rotated (regenerated) and returned.
 * - If no local key exists, a key is provisioned. If one exists server-side but can't
 *   be returned, it is regenerated to obtain the value.
 *
 * Returns `null` if provisioning fails (OAuth login can still succeed without it).
 */
export async function ensureDextoApiKeyForAuthToken(
    authToken: string,
    options: EnsureDextoApiKeyOptions = {}
): Promise<{ dextoApiKey: string; keyId: string } | null> {
    const status = (message: string) => options.onStatus?.(message);

    try {
        const apiClient = getDextoApiClient();
        const auth = await loadAuth();

        if (!auth) {
            throw new Error('Authentication state not found');
        }

        if (auth.dextoApiKey) {
            status('🔍 Validating existing API key...');

            const isValid = await apiClient.validateDextoApiKey(auth.dextoApiKey);
            if (isValid) {
                status('✅ Existing key is valid');
                await saveDextoApiKeyToEnv(auth.dextoApiKey);
                return { dextoApiKey: auth.dextoApiKey, keyId: auth.dextoKeyId ?? '' };
            }

            status('⚠️  Existing key is invalid, rotating...');
            const rotated = await apiClient.provisionDextoApiKey(authToken, 'Dexto CLI Key', true);

            await storeAuth({
                ...auth,
                dextoApiKey: rotated.dextoApiKey,
                dextoKeyId: rotated.keyId,
            });
            await saveDextoApiKeyToEnv(rotated.dextoApiKey);
            status('✅ New key provisioned');
            return { dextoApiKey: rotated.dextoApiKey, keyId: rotated.keyId };
        }

        status('🔑 Provisioning Dexto API key...');
        let provisioned = await apiClient.provisionDextoApiKey(authToken);

        if (!provisioned.isNewKey) {
            status('⚠️  Key exists on server, regenerating...');
            provisioned = await apiClient.provisionDextoApiKey(authToken, 'Dexto CLI Key', true);
        }

        await storeAuth({
            ...auth,
            dextoApiKey: provisioned.dextoApiKey,
            dextoKeyId: provisioned.keyId,
        });
        await saveDextoApiKeyToEnv(provisioned.dextoApiKey);
        status('✅ Dexto API key provisioned');

        return { dextoApiKey: provisioned.dextoApiKey, keyId: provisioned.keyId };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to ensure DEXTO_API_KEY: ${errorMessage}`);
        status(`❌ Failed to provision Dexto API key: ${errorMessage}`);
        return null;
    }
}
