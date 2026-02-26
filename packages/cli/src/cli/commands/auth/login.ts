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
} from '../../auth/index.js';
import { logger } from '@dexto/core';

export interface LoginCommandOptions {
    apiKey?: string;
    token?: string;
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

/**
 * Handle login command:
 * - `--token` validates/stores an existing Supabase access token.
 * - default path runs device-code login.
 */
export async function handleLoginCommand(options: LoginCommandOptions = {}): Promise<void> {
    try {
        if (options.apiKey && options.token) {
            throw new Error('Cannot use both --api-key and --token. Choose one.');
        }

        if (await isAuthenticated()) {
            const auth = await loadAuth();
            const userInfo = auth?.email || auth?.userId || 'user';
            console.log(chalk.green(`✅ Already logged in as: ${userInfo}`));

            if (!options.apiKey && !options.token) {
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

        if (options.token) {
            await handleTokenLogin(options.token);
        } else {
            await handleDeviceLogin();
        }

        console.log(chalk.green('🎉 Login successful!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`❌ Login failed: ${errorMessage}`));
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

async function handleTokenLogin(token: string): Promise<void> {
    const trimmedToken = token.trim();
    if (trimmedToken.length < 10) {
        throw new Error('Token seems too short');
    }

    const spinner = p.spinner();
    spinner.start('Verifying token...');

    try {
        const isValid = await verifyToken(trimmedToken);
        if (!isValid) {
            spinner.stop('Invalid token');
            throw new Error('Token verification failed');
        }

        spinner.stop('Token verified!');

        await storeAuth({
            token: trimmedToken,
            createdAt: Date.now(),
        });

        const ensured = await ensureDextoApiKeyForAuthToken(trimmedToken, {
            onStatus: printProvisionStatus,
        });
        printProvisionResult({
            keyId: ensured?.keyId ?? undefined,
            hasDextoApiKey: Boolean(ensured?.dextoApiKey),
        });
    } catch (error) {
        spinner.stop('Verification failed');
        throw error;
    }
}

async function verifyToken(token: string): Promise<boolean> {
    try {
        const apiClient = getDextoApiClient();
        return apiClient.validateSupabaseAccessToken(token);
    } catch (error) {
        logger.debug(
            `Token verification failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}
