// packages/cli/src/cli/commands/auth/login.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    DEFAULT_OAUTH_CONFIG,
    type DextoApiKeyProvisionStatus,
    getDextoApiClient,
    isAuthenticated,
    loadAuth,
    performDeviceCodeLogin,
    performOAuthLogin,
    persistOAuthLoginResult,
    shouldAttemptBrowserLaunch,
    storeAuth,
    ensureDextoApiKeyForAuthToken,
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
} from '../../auth/index.js';
import { logger } from '@dexto/core';

type LoginAuthMode = 'auto' | 'browser' | 'device';

type LoginMethod = LoginAuthMode | 'token';

export interface LoginCommandOptions {
    apiKey?: string;
    interactive?: boolean;
    authMode?: string;
    device?: boolean;
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
    return lower.includes('cancel') || lower.includes('denied');
}

function parseAuthMode(rawMode: string): LoginAuthMode {
    const normalized = rawMode.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'browser' || normalized === 'device') {
        return normalized;
    }
    throw new Error(`Invalid --auth-mode: ${rawMode}. Use one of: auto, browser, device`);
}

function resolveRequestedAuthMode(options: LoginCommandOptions): LoginAuthMode | null {
    if (options.device) {
        return 'device';
    }
    if (!options.authMode) {
        return null;
    }
    return parseAuthMode(options.authMode);
}

async function chooseInteractiveLoginMethod(): Promise<LoginMethod | null> {
    const browserLikelyUsable = shouldAttemptBrowserLaunch();
    const selected = await p.select({
        message: 'Choose a login method:',
        options: [
            {
                value: 'browser',
                label: browserLikelyUsable ? 'Browser callback (Recommended)' : 'Browser callback',
                hint: browserLikelyUsable
                    ? 'Fastest when this machine has a usable browser'
                    : 'May fail in headless/remote environments',
            },
            {
                value: 'device',
                label: browserLikelyUsable ? 'Device code' : 'Device code (Recommended)',
                hint: browserLikelyUsable
                    ? 'Use another device/browser to approve login'
                    : 'Works reliably in VM/headless/SSH sessions',
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

    return selected as LoginMethod;
}

/**
 * Handle login command - multiple methods supported
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

        const requestedAuthMode = resolveRequestedAuthMode(options);

        if (options.interactive === false) {
            await runLoginMethod(requestedAuthMode ?? 'auto');
            console.log(chalk.green('🎉 Login successful!'));
            return;
        }

        p.intro(chalk.inverse(' Login to Dexto '));

        if (requestedAuthMode) {
            await runLoginMethod(requestedAuthMode);
            p.outro(chalk.green('🎉 Login successful!'));
            return;
        }

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
            await runLoginMethod(selectedMethod);
        }

        p.outro(chalk.green('🎉 Login successful!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Login failed: ${errorMessage}`));
        throw error;
    }
}

async function runLoginMethod(mode: LoginAuthMode): Promise<void> {
    if (mode === 'browser') {
        await handleBrowserLogin();
        return;
    }
    if (mode === 'device') {
        await handleDeviceLogin();
        return;
    }
    await handleAutoLogin();
}

export async function handleAutoLogin(): Promise<void> {
    const browserLikelyUsable = shouldAttemptBrowserLaunch();

    if (browserLikelyUsable) {
        try {
            await handleBrowserLogin();
            return;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (isCancellationError(errorMessage)) {
                throw error;
            }
            console.log(
                chalk.yellow(
                    '⚠️ Browser login failed in this environment. Switching to device code.'
                )
            );
        }
    } else {
        console.log(chalk.dim('Detected headless/remote environment, using device code login.'));
    }

    await handleDeviceLogin();
}

export async function handleBrowserLogin(): Promise<void> {
    try {
        const result = await performOAuthLogin(DEFAULT_OAUTH_CONFIG);
        const persisted = await persistOAuthLoginResult(result, {
            onProvisionStatus: printProvisionStatus,
        });

        if (persisted.email) {
            console.log(chalk.dim(`\nWelcome back, ${persisted.email}`));
        }

        printProvisionResult(persisted);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('timed out')) {
            throw new Error('Login timed out. Please try again.');
        }
        if (errorMessage.includes('user denied') || isCancellationError(errorMessage)) {
            throw new Error('Login was cancelled.');
        }
        throw new Error(`Login failed: ${errorMessage}`);
    }
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

    if (p.isCancel(token)) {
        return false;
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

        const ensured = await ensureDextoApiKeyForAuthToken(token as string, {
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
