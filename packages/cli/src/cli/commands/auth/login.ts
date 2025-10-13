// packages/cli/src/cli/commands/auth/login.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { isAuthenticated, loadAuth, storeAuth } from '../../utils/auth-service.js';
import { getDextoApiClient } from '../../utils/dexto-api-client.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/constants.js';
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

                if (!shouldContinue) {
                    return;
                }
            }
        }

        if (options.token) {
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
        process.exit(1);
    }
}

export async function handleBrowserLogin(): Promise<void> {
    const { performOAuthLogin, DEFAULT_OAUTH_CONFIG } = await import('../../utils/oauth-flow.js');

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

async function provisionKeys(authToken: string, _userEmail?: string): Promise<void> {
    try {
        const apiClient = await getDextoApiClient();
        console.log(chalk.cyan('🔑 Provisioning Dexto API key...'));
        const { dextoApiKey, keyId, isNewKey } = await apiClient.provisionDextoApiKey(authToken);

        const auth = await loadAuth();
        if (auth) {
            await storeAuth({ ...auth, dextoApiKey, dextoKeyId: keyId });
        }

        // Persist to ~/.dexto/.env
        const { saveProviderApiKey } = await import('@dexto/core');
        const { envVar, targetEnvPath } = await saveProviderApiKey('dexto', dextoApiKey);

        if (isNewKey) {
            console.log(chalk.green('✅ Dexto API key created and configured!'));
        } else {
            console.log(chalk.green('✅ Using existing Dexto API key!'));
        }
        console.log(chalk.dim(`   Key ID: ${keyId}`));
        console.log(chalk.dim(`   Saved ${envVar} to ${targetEnvPath}`));
        console.log(chalk.dim('   Provider set to dexto by default in subsequent setup'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.yellow(`⚠️  Failed to provision Dexto API key: ${errorMessage}`));
        console.log(chalk.dim('   You can still use Dexto with your own API keys'));
        logger.warn(`Provisioning failed: ${errorMessage}`);
    }
}
