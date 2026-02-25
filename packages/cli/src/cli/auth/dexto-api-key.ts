import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDextoGlobalDirectory, getDextoEnvPath, logger } from '@dexto/core';
import { getDextoApiClient } from './api-client.js';
import { loadAuth, storeAuth } from './service.js';

export interface EnsureDextoApiKeyOptions {
    onStatus?: ((message: string) => void) | undefined;
}

async function ensureOwnerOnlyPermissions(filePath: string): Promise<void> {
    try {
        await fs.chmod(filePath, 0o600);
    } catch (error) {
        logger.warn('Failed to set permissions on env file', {
            filePath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
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

    const nextContent = lines.filter(Boolean).join('\n') + '\n';
    await fs.writeFile(targetEnvPath, nextContent, { encoding: 'utf-8', mode: 0o600 });
    await ensureOwnerOnlyPermissions(targetEnvPath);
    process.env[envVar] = apiKey;
}

export async function removeDextoApiKeyFromEnv(options: { expectedValue?: string } = {}): Promise<{
    removed: boolean;
    targetEnvPath: string;
}> {
    const envVar = 'DEXTO_API_KEY';
    const targetEnvPath = getDextoEnvPath();
    const clearProcessEnv = () => {
        const currentValue = process.env[envVar];
        if (!currentValue) return;
        if (!options.expectedValue || currentValue === options.expectedValue) {
            delete process.env[envVar];
        }
    };

    let envContent = '';
    try {
        envContent = await fs.readFile(targetEnvPath, 'utf-8');
    } catch {
        clearProcessEnv();
        return { removed: false, targetEnvPath };
    }

    const lines = envContent.split('\n');
    const keyPattern = new RegExp(`^${envVar}=(.*)$`);
    const keyLineIndex = lines.findIndex((line) => keyPattern.test(line));

    if (keyLineIndex < 0) {
        clearProcessEnv();
        return { removed: false, targetEnvPath };
    }

    if (options.expectedValue) {
        const match = lines[keyLineIndex]?.match(keyPattern);
        const currentValue = match?.[1] ?? '';
        if (currentValue !== options.expectedValue) {
            clearProcessEnv();
            return { removed: false, targetEnvPath };
        }
    }

    lines.splice(keyLineIndex, 1);

    const nextLines = lines.filter(Boolean);
    const nextContent = nextLines.length ? nextLines.join('\n') + '\n' : '';

    try {
        await fs.writeFile(targetEnvPath, nextContent, { encoding: 'utf-8', mode: 0o600 });
        await ensureOwnerOnlyPermissions(targetEnvPath);
    } catch (error) {
        clearProcessEnv();
        throw new Error(
            `Failed to remove ${envVar} from ${targetEnvPath}: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    clearProcessEnv();
    return { removed: true, targetEnvPath };
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
): Promise<{ dextoApiKey: string; keyId: string | null } | null> {
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
                if (!auth.dextoApiKeySource && auth.dextoKeyId) {
                    await storeAuth({
                        ...auth,
                        dextoApiKeySource: 'provisioned',
                    });
                }
                await saveDextoApiKeyToEnv(auth.dextoApiKey);
                return { dextoApiKey: auth.dextoApiKey, keyId: auth.dextoKeyId ?? null };
            }

            status('⚠️  Existing key is invalid, rotating...');
            const rotated = await apiClient.provisionDextoApiKey(authToken, 'Dexto CLI Key', true);

            await storeAuth({
                ...auth,
                dextoApiKey: rotated.dextoApiKey,
                dextoKeyId: rotated.keyId,
                dextoApiKeySource: 'provisioned',
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
            dextoApiKeySource: 'provisioned',
        });
        await saveDextoApiKeyToEnv(provisioned.dextoApiKey);
        status('✅ Dexto API key provisioned');

        return { dextoApiKey: provisioned.dextoApiKey, keyId: provisioned.keyId };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to ensure DEXTO_API_KEY', { error: errorMessage });
        status(`❌ Failed to provision Dexto API key: ${errorMessage}`);
        return null;
    }
}
