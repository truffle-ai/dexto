// packages/cli/src/cli/commands/auth/login.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import open from 'open';
import {
    type DextoApiKeyProvisionStatus,
    getDextoApiClient,
    isAuthenticated,
    loadAuth,
    performDeviceCodeLogin,
    persistOAuthLoginResult,
    storeAuth,
    ensureDextoApiKeyForAuthToken,
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
} from '../../auth/index.js';
import { logger } from '@dexto/core';

type LoginMethod = 'device' | 'token';

export interface LoginCommandOptions {
    apiKey?: string;
    interactive?: boolean;
}

function printProvisionStatus(status: DextoApiKeyProvisionStatus): void {
    switch (status.level) {
        case 'success':
            console.log(chalk.green(`✅ ${status.message}`));
            return;
        case 'error':
            console.log(chalk.red(`❌ ${status.message}`));
            return;
        case 'warning':
            console.log(chalk.yellow(`⚠️ ${status.message}`));
            return;
        case 'info':
            console.log(chalk.cyan(`ℹ️ ${status.message}`));
            return;
    }
}

function printProvisionResult(result: {
    keyId?: string | undefined;
    hasDextoApiKey: boolean;
}): void {
    if (result.keyId) {
        console.log(chalk.dim(`   Key ID: ${result.keyId}`));
    }
    if (!result.hasDextoApiKey) {
        console.log(chalk.dim('   You can still use Dexto with your own API keys'));
    }
}

function isCancellationError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    return (
        lower.includes('canceled') ||
        lower.includes('cancelled') ||
        lower.includes('user denied') ||
        lower.includes('user_denied') ||
        lower.includes('access_denied') ||
        lower.includes('access denied by user')
    );
}

async function chooseInteractiveLoginMethod(): Promise<LoginMethod | null> {
    const selected = await p.select({
        message: 'Choose a login method:',
        options: [
            {
                value: 'device',
                label: 'Device code login (Recommended)',
                hint: 'Secure and reliable in local, remote, and headless environments',
            },
            {
                value: 'token',
                label: 'Enter token manually',
                hint: 'Paste an existing auth token',
            },
        ],
    });

    if (p.isCancel(selected)) {
        return null;
    }

    if (selected === 'device' || selected === 'token') {
        return selected;
    }

    throw new Error('Unexpected login method selection');
}

/**
 * Handle login command - supports device-code and manual token login.
 */
export async function handleLoginCommand(options: LoginCommandOptions = {}): Promise<void> {
    try {
        if (await isAuthenticated()) {
            const auth = await loadAuth();
            const userInfo = auth?.email || auth?.userId || 'user';
            console.log(chalk.green(`✅ Already logged in as: ${userInfo}`));

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
            await handleDeviceLogin();
            console.log(chalk.green('🎉 Login successful!'));
            return;
        }

        p.intro(chalk.inverse(' Login to Dexto '));

        const selectedMethod = await chooseInteractiveLoginMethod();
        if (!selectedMethod) {
            p.cancel('Login cancelled');
            return;
        }

        if (selectedMethod === 'token') {
            const didLogin = await handleTokenLogin();
            if (!didLogin) {
                p.cancel('Login cancelled');
                return;
            }
        } else {
            await handleDeviceLogin();
        }

        p.outro(chalk.green('🎉 Login successful!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Login failed: ${errorMessage}`));
        throw error;
    }
}

export async function handleDeviceLogin(): Promise<void> {
    try {
        const result = await performDeviceCodeLogin({
            onPrompt: async (prompt) => {
                const verificationTarget = prompt.verificationUrlComplete ?? prompt.verificationUrl;

                console.log(chalk.cyan('\nOpen your browser to complete login:'));
                try {
                    await open(verificationTarget);
                    console.log(chalk.dim(`  • Opened automatically: ${verificationTarget}`));
                } catch (error) {
                    logger.debug(
                        `Automatic browser launch failed during device login: ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                    console.log(chalk.dim(`  • Open: ${verificationTarget}`));
                }

                if (prompt.verificationUrlComplete) {
                    console.log(chalk.dim(`  • If asked, code: ${prompt.userCode}`));
                } else {
                    console.log(chalk.dim(`  • Enter code: ${prompt.userCode}`));
                }

                console.log(
                    chalk.dim(`  • Code expires in ~${Math.ceil(prompt.expiresIn / 60)} min`)
                );
            },
        });

        const persisted = await persistOAuthLoginResult(result, {
            onProvisionStatus: printProvisionStatus,
        });

        if (persisted.email) {
            console.log(chalk.dim(`\nWelcome back, ${persisted.email}`));
        }
        printProvisionResult(persisted);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isCancellationError(errorMessage)) {
            throw new Error('Login was cancelled.');
        }
        throw new Error(`Device login failed: ${errorMessage}`);
    }
}

async function handleTokenLogin(): Promise<boolean> {
    const token = await p.password({
        message: 'Enter your API token:',
        validate: (value) => {
            if (!value) return 'Token is required';
            if (value.length < 10) return 'Token seems too short';
            return undefined;
        },
    });

    if (p.isCancel(token) || typeof token !== 'string') {
        return false;
    }

    const spinner = p.spinner();
    spinner.start('Verifying token...');

    try {
        const isValid = await verifyToken(token);
        if (!isValid) {
            spinner.stop('Invalid token');
            throw new Error('Token verification failed');
        }

        spinner.stop('Token verified!');

        await storeAuth({
            token,
            createdAt: Date.now(),
        });

        const ensured = await ensureDextoApiKeyForAuthToken(token, {
            onStatus: printProvisionStatus,
        });
        printProvisionResult({
            keyId: ensured?.keyId ?? undefined,
            hasDextoApiKey: Boolean(ensured?.dextoApiKey),
        });
        return true;
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
            return Boolean(userData.id);
        }

        return false;
    } catch (error) {
        logger.debug(
            `Token verification failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}
