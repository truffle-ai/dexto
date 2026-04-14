// packages/cli/src/cli/commands/auth/login.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    getDextoApiClient,
    isAuthenticated,
    loadAuth,
    performDeviceCodeLogin,
    persistOAuthLoginResult,
    storeAuth,
} from '../../auth/index.js';

export interface LoginCommandOptions {
    apiKey?: string;
    token?: string;
    interactive?: boolean;
}

function isCancellationError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    return (
        lower.includes('canceled') ||
        lower.includes('cancelled') ||
        lower.includes('user denied') ||
        lower.includes('user_denied') ||
        lower.includes('access_denied') ||
        lower.includes('access denied by user') ||
        lower.includes('device login was denied')
    );
}

// Handle login command with device code as the default flow.
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
            const didLogin = await handleTokenLogin(options.token);
            if (!didLogin) {
                throw new Error('Login was cancelled.');
            }
            console.log(chalk.green('🎉 Login successful!'));
            return;
        }

        if (options.interactive === false) {
            await handleDeviceLogin();
            console.log(chalk.green('🎉 Login successful!'));
            return;
        }

        p.intro(chalk.inverse(' Login to Dexto '));
        await handleDeviceLogin();
        p.outro(chalk.green('🎉 Login successful!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Login failed: ${errorMessage}`));
        throw error;
    }
}

// Compatibility wrapper used by setup flow; always device login.
export async function handleAutoLogin(): Promise<void> {
    await handleDeviceLogin();
}

export async function handleDeviceLogin(): Promise<void> {
    try {
        const result = await performDeviceCodeLogin({
            onPrompt: (prompt) => {
                console.log(chalk.cyan('\nUse any browser to complete login:'));
                if (prompt.verificationUrlComplete) {
                    console.log(chalk.dim(`  • Open: ${prompt.verificationUrlComplete}`));
                    console.log(chalk.dim(`  • If asked, code: ${prompt.userCode}`));
                } else {
                    console.log(chalk.dim(`  • Open: ${prompt.verificationUrl}`));
                    console.log(chalk.dim(`  • Enter code: ${prompt.userCode}`));
                }
                console.log(
                    chalk.dim(`  • Code expires in ~${Math.ceil(prompt.expiresIn / 60)} min`)
                );
            },
        });

        const persisted = await persistOAuthLoginResult(result);
        if (persisted.email) {
            console.log(chalk.dim(`\nWelcome back, ${persisted.email}`));
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isCancellationError(errorMessage)) {
            throw new Error('Login was cancelled.');
        }
        throw new Error(`Device login failed: ${errorMessage}`);
    }
}

async function handleTokenLogin(tokenInput?: string): Promise<boolean> {
    let token = tokenInput?.trim();
    if (!token) {
        const promptedToken = await p.password({
            message: 'Enter your API token:',
            validate: (value) => {
                if (!value) return 'Token is required';
                if (value.length < 10) return 'Token seems too short';
                return undefined;
            },
        });

        if (p.isCancel(promptedToken)) {
            return false;
        }

        token = promptedToken as string;
    }
    if (token.length < 10) {
        throw new Error('Token seems too short');
    }

    const spinner = p.spinner();
    spinner.start('Verifying token...');

    try {
        const apiClient = getDextoApiClient();
        const user = await apiClient.fetchSupabaseUser(token);
        if (!user) {
            spinner.stop('Invalid token');
            throw new Error('Token verification failed');
        }

        spinner.stop('Token verified!');

        await persistOAuthLoginResult({
            accessToken: token,
            user,
        });
        return true;
    } catch (error) {
        spinner.stop('Verification failed');
        throw error;
    }
}
