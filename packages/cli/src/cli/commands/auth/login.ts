// packages/cli/src/cli/commands/auth/login.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    isAuthenticated,
    loadAuth,
    storeAuth,
    getDextoApiClient,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
} from '../../auth/index.js';
import { logger } from '@dexto/core';

/**
 * Handle login command - multiple methods supported
 */
export async function handleLoginCommand(
    options: {
        token?: string;
        interactive?: boolean;
    } = {}
): Promise<void> {
    try {
        if (await isAuthenticated()) {
            const auth = await loadAuth();
            const userInfo = auth?.email || auth?.userId || 'user';
            console.log(chalk.green(`✅ Already logged in as: ${userInfo}`));

            if (options.interactive !== false) {
                const shouldContinue = await p.confirm({
                    message: 'Do you want to login with a different account?',
                    initialValue: false,
                });

                if (p.isCancel(shouldContinue) || !shouldContinue) {
                    return;
                }
            }
        }

        if (options.token) {
            // Validate the token before storing
            const client = getDextoApiClient();
            const isValid = await client.validateDextoApiKey(options.token);
            if (!isValid) {
                throw new Error('Invalid token provided - validation failed');
            }
            await storeAuth({ token: options.token, createdAt: Date.now() });
            console.log(chalk.green('✅ Authentication token saved'));
            return;
        }

        if (options.interactive === false) {
            throw new Error('Token is required when --no-interactive is used');
        }

        p.intro(chalk.inverse(' Login to Dexto '));
        console.log(chalk.dim('This will open your browser for authentication.'));

        const shouldUseOAuth = await p.confirm({
            message: 'Continue with browser authentication?',
            initialValue: true,
        });

        if (p.isCancel(shouldUseOAuth)) {
            p.cancel('Login cancelled');
            return;
        }

        if (shouldUseOAuth) {
            await handleBrowserLogin();
        } else {
            console.log(chalk.dim('\nAlternatively, you can enter a token manually:'));
            await handleTokenLogin();
        }

        p.outro(chalk.green('🎉 Login successful!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Login failed: ${errorMessage}`));
        // Re-throw to let CLI wrapper handle exit and analytics tracking
        throw error;
    }
}

export async function handleBrowserLogin(): Promise<void> {
    const { performOAuthLogin, DEFAULT_OAUTH_CONFIG } = await import('../../auth/oauth.js');

    try {
        const result = await performOAuthLogin(DEFAULT_OAUTH_CONFIG);
        const expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;

        await storeAuth({
            token: result.accessToken,
            refreshToken: result.refreshToken,
            userId: result.user?.id,
            email: result.user?.email,
            createdAt: Date.now(),
            expiresAt,
        });

        console.log(chalk.green('\n🎉 Login successful!'));
        if (result.user?.email) {
            console.log(chalk.dim(`Welcome back, ${result.user.email}`));
        }

        await provisionKeys(result.accessToken, result.user?.email);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('timed out')) {
            throw new Error('Login timed out. Please try again.');
        } else if (errorMessage.includes('user denied')) {
            throw new Error('Login was cancelled.');
        } else {
            throw new Error(`Login failed: ${errorMessage}`);
        }
    }
}

async function handleTokenLogin(): Promise<void> {
    const token = await p.password({
        message: 'Enter your API token:',
        validate: (value) => {
            if (!value) return 'Token is required';
            if (value.length < 10) return 'Token seems too short';
            return undefined;
        },
    });

    if (p.isCancel(token)) {
        p.cancel('Token entry cancelled');
        return;
    }

    const spinner = p.spinner();
    spinner.start('Verifying token...');

    try {
        const isValid = await verifyToken(token as string);

        if (!isValid) {
            spinner.stop('Invalid token');
            throw new Error('Token verification failed');
        }

        spinner.stop('Token verified!');

        await storeAuth({
            token: token as string,
            createdAt: Date.now(),
        });
    } catch (error) {
        spinner.stop('Verification failed');
        throw error;
    }
}

async function verifyToken(token: string): Promise<boolean> {
    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: SUPABASE_ANON_KEY,
                'User-Agent': 'dexto-cli/1.0.0',
            },
        });

        if (response.ok) {
            const userData = await response.json();
            return !!userData.id;
        }

        return false;
    } catch (error) {
        logger.debug(
            `Token verification failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}

/**
 * Helper to save Dexto API key to ~/.dexto/.env
 * Returns the env var and path for display purposes
 */
async function saveDextoApiKey(apiKey: string): Promise<{ envVar: string; targetEnvPath: string }> {
    const { getDextoEnvPath, ensureDextoGlobalDirectory } = await import('@dexto/core');
    const path = await import('path');
    const fs = await import('fs/promises');

    const envVar = 'DEXTO_API_KEY';
    const targetEnvPath = getDextoEnvPath();

    // Ensure directory exists
    await ensureDextoGlobalDirectory();
    await fs.mkdir(path.dirname(targetEnvPath), { recursive: true });

    // Read existing .env or create empty
    let envContent = '';
    try {
        envContent = await fs.readFile(targetEnvPath, 'utf-8');
    } catch {
        // File doesn't exist, start fresh
    }

    // Update or add the key
    const lines = envContent.split('\n');
    const keyPattern = new RegExp(`^${envVar}=`);
    const keyIndex = lines.findIndex((line) => keyPattern.test(line));

    if (keyIndex >= 0) {
        lines[keyIndex] = `${envVar}=${apiKey}`;
    } else {
        lines.push(`${envVar}=${apiKey}`);
    }

    // Write back
    await fs.writeFile(targetEnvPath, lines.filter(Boolean).join('\n') + '\n', 'utf-8');

    // Make available in current process
    process.env[envVar] = apiKey;

    return { envVar, targetEnvPath };
}

async function provisionKeys(authToken: string, _userEmail?: string): Promise<void> {
    try {
        const apiClient = await getDextoApiClient();
        const auth = await loadAuth();

        // 1. Check if we already have a local key
        if (auth?.dextoApiKey) {
            console.log(chalk.cyan('🔍 Validating existing API key...'));

            try {
                const isValid = await apiClient.validateDextoApiKey(auth.dextoApiKey);

                if (isValid) {
                    console.log(chalk.green('✅ Existing key is valid'));

                    // Persist to ~/.dexto/.env (in case it's missing)
                    await saveDextoApiKey(auth.dextoApiKey);
                    return; // All good, we're done
                }

                // Key is invalid - need new one
                console.log(chalk.yellow('⚠️  Existing key is invalid, provisioning new one...'));
                const provisionResult = await apiClient.provisionDextoApiKey(authToken);

                if (!auth) {
                    throw new Error('Authentication state not found');
                }

                if (!provisionResult.dextoApiKey) {
                    throw new Error('Failed to get new API key');
                }

                await storeAuth({
                    ...auth,
                    dextoApiKey: provisionResult.dextoApiKey,
                    dextoKeyId: provisionResult.keyId,
                });

                // Persist to ~/.dexto/.env
                await saveDextoApiKey(provisionResult.dextoApiKey);

                console.log(chalk.green('✅ New key provisioned'));
                console.log(chalk.dim(`   Key ID: ${provisionResult.keyId}`));
                return;
            } catch (error) {
                // Validation or rotation failed - this is a critical error
                logger.warn(`Key validation/rotation failed: ${error}`);
                throw new Error(
                    `Failed to validate or rotate key: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // 2. No local key - provision one
        console.log(chalk.cyan('🔑 Provisioning Dexto API key...'));
        let provisionResult = await apiClient.provisionDextoApiKey(authToken);

        if (!auth) {
            throw new Error('Authentication state not found');
        }

        // If key already exists server-side but we don't have it locally, regenerate it
        if (!provisionResult.isNewKey) {
            console.log(
                chalk.yellow('⚠️  CLI key exists on server but not locally, regenerating...')
            );
            provisionResult = await apiClient.provisionDextoApiKey(
                authToken,
                'Dexto CLI Key',
                true
            );
        }

        await storeAuth({
            ...auth,
            dextoApiKey: provisionResult.dextoApiKey,
            dextoKeyId: provisionResult.keyId,
        });

        // Persist to ~/.dexto/.env
        const { envVar, targetEnvPath } = await saveDextoApiKey(provisionResult.dextoApiKey);

        console.log(chalk.green('✅ Dexto API key provisioned!'));
        console.log(chalk.dim(`   Key ID: ${provisionResult.keyId}`));
        console.log(chalk.dim(`   Saved ${envVar} to ${targetEnvPath}`));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`❌ Failed to provision Dexto API key: ${errorMessage}`));
        console.log(chalk.dim('   You can still use Dexto with your own API keys'));
        logger.warn(`Provisioning failed: ${errorMessage}`);
        // Don't throw - login should still succeed even if key provisioning fails
    }
}
