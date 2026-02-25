// packages/cli/src/cli/commands/auth/login.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    isAuthenticated,
    loadAuth,
    storeAuth,
    getDextoApiClient,
    ensureDextoApiKeyForAuthToken,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
} from '../../auth/index.js';
import { logger } from '@dexto/core';

function printProvisionStatus(message: string): void {
    const trimmed = message.trim();
    if (trimmed.startsWith('✅')) {
        console.log(chalk.green(trimmed));
        return;
    }
    if (trimmed.startsWith('❌')) {
        console.log(chalk.red(trimmed));
        return;
    }
    if (trimmed.startsWith('⚠️')) {
        console.log(chalk.yellow(trimmed));
        return;
    }
    if (trimmed.startsWith('🔍') || trimmed.startsWith('🔑')) {
        console.log(chalk.cyan(trimmed));
        return;
    }
    console.log(trimmed);
}

/**
 * Handle login command - multiple methods supported
 */
export async function handleLoginCommand(
    options: {
        apiKey?: string;
        interactive?: boolean;
    } = {}
): Promise<void> {
    try {
        if (await isAuthenticated()) {
            const auth = await loadAuth();
            const userInfo = auth?.email || auth?.userId || 'user';
            console.log(chalk.green(`✅ Already logged in as: ${userInfo}`));

            // In non-interactive mode, already authenticated = success (idempotent)
            if (options.interactive === false) {
                return;
            }

            const shouldContinue = await p.confirm({
                message: 'Do you want to login with a different account?',
                initialValue: false,
            });

            if (p.isCancel(shouldContinue) || !shouldContinue) {
                return;
            }
        }

        if (options.apiKey) {
            // Validate the Dexto API key before storing
            const client = getDextoApiClient();
            const isValid = await client.validateDextoApiKey(options.apiKey);
            if (!isValid) {
                throw new Error('Invalid API key provided - validation failed');
            }
            await storeAuth({
                dextoApiKey: options.apiKey,
                dextoApiKeySource: 'user-supplied',
                createdAt: Date.now(),
            });
            console.log(chalk.green('✅ Dexto API key saved'));
            return;
        }

        if (options.interactive === false) {
            throw new Error('--api-key is required when --no-interactive is used');
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

        if (result.user?.email) {
            console.log(chalk.dim(`\nWelcome back, ${result.user.email}`));
        }

        const ensured = await ensureDextoApiKeyForAuthToken(result.accessToken, {
            onStatus: printProvisionStatus,
        });
        if (ensured?.keyId) {
            console.log(chalk.dim(`   Key ID: ${ensured.keyId}`));
        }
        if (!ensured) {
            console.log(chalk.dim('   You can still use Dexto with your own API keys'));
        }
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

        // Provision Dexto API key for gateway access
        const ensured = await ensureDextoApiKeyForAuthToken(token as string, {
            onStatus: printProvisionStatus,
        });
        if (ensured?.keyId) {
            console.log(chalk.dim(`   Key ID: ${ensured.keyId}`));
        }
        if (!ensured) {
            console.log(chalk.dim('   You can still use Dexto with your own API keys'));
        }
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
            signal: AbortSignal.timeout(10_000),
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
