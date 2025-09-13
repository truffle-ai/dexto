// packages/cli/src/cli/commands/auth.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { z } from 'zod';
import { getDextoGlobalPath } from '@dexto/core';
import { existsSync, promises as fs } from 'fs';
import { logger } from '@dexto/core';

const AUTH_CONFIG_FILE = 'auth.json';

interface AuthConfig {
    token: string;
    userId?: string | undefined;
    email?: string | undefined;
    expiresAt?: number | undefined;
    createdAt: number;
}

const AuthConfigSchema = z.object({
    token: z.string().min(1),
    userId: z.string().optional(),
    email: z.string().email().optional(),
    expiresAt: z.number().optional(),
    createdAt: z.number(),
});

/**
 * Store authentication token
 */
async function storeAuth(config: AuthConfig): Promise<void> {
    const authPath = getDextoGlobalPath(AUTH_CONFIG_FILE);
    const dextoDir = getDextoGlobalPath('');

    await fs.mkdir(dextoDir, { recursive: true });
    await fs.writeFile(authPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    logger.debug(`Stored auth config at: ${authPath}`);
}

/**
 * Load authentication config
 */
async function loadAuth(): Promise<AuthConfig | null> {
    const authPath = getDextoGlobalPath(AUTH_CONFIG_FILE);

    if (!existsSync(authPath)) {
        return null;
    }

    try {
        const content = await fs.readFile(authPath, 'utf-8');
        const config = JSON.parse(content);

        const validated = AuthConfigSchema.parse(config);

        // Check if token is expired
        if (validated.expiresAt && validated.expiresAt < Date.now()) {
            await removeAuth();
            return null;
        }

        return validated;
    } catch (error) {
        logger.warn(`Invalid auth config, removing: ${error}`);
        await removeAuth();
        return null;
    }
}

/**
 * Remove stored authentication
 */
async function removeAuth(): Promise<void> {
    const authPath = getDextoGlobalPath(AUTH_CONFIG_FILE);

    if (existsSync(authPath)) {
        await fs.unlink(authPath);
        logger.debug(`Removed auth config from: ${authPath}`);
    }
}

/**
 * Check if authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
    const auth = await loadAuth();
    return auth !== null;
}

/**
 * Get current auth token for API calls
 */
export async function getAuthToken(): Promise<string | null> {
    const auth = await loadAuth();
    return auth?.token || null;
}

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
        // Check if already authenticated
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
            // Direct token method
            await storeAuth({
                token: options.token,
                createdAt: Date.now(),
            });
            console.log(chalk.green('✅ Authentication token saved'));
            return;
        }

        if (options.interactive === false) {
            throw new Error('Token is required when --no-interactive is used');
        }

        // Interactive login - default to OAuth (like GitHub CLI, Vercel CLI, etc.)
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
            // OAuth Flow (default)
            await handleBrowserLogin();
        } else {
            // Manual token entry (fallback)
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

/**
 * Browser-based OAuth login (proper OAuth flow)
 */
async function handleBrowserLogin(): Promise<void> {
    const { performOAuthLogin, DEFAULT_OAUTH_CONFIG } = await import('../utils/oauth-flow.js');

    try {
        // Perform OAuth login with PKCE
        const result = await performOAuthLogin(DEFAULT_OAUTH_CONFIG);

        // Store the authentication result
        const expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;

        await storeAuth({
            token: result.accessToken,
            userId: result.user?.id,
            email: result.user?.email,
            createdAt: Date.now(),
            expiresAt,
        });

        console.log(chalk.green('\n🎉 Login successful!'));
        if (result.user?.email) {
            console.log(chalk.dim(`Welcome back, ${result.user.email}`));
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

/**
 * Manual token entry
 */
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

    // Verify token with your API (simplified)
    const spinner = p.spinner();
    spinner.start('Verifying token...');

    try {
        // In real implementation, validate token with your Supabase backend
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

/**
 * Verify token directly with Supabase Auth
 */
async function verifyToken(token: string): Promise<boolean> {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
            logger.warn(
                'Supabase URL or Anon Key not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
            );
            return false;
        }

        // Verify token directly with Supabase Auth API
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: supabaseAnonKey,
                'User-Agent': 'dexto-cli/1.0.0',
            },
        });

        if (response.ok) {
            const userData = await response.json();
            return !!userData.id; // Token is valid if we get user data
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
 * Handle logout command
 */
export async function handleLogoutCommand(
    options: {
        force?: boolean;
        interactive?: boolean;
    } = {}
): Promise<void> {
    try {
        if (!(await isAuthenticated())) {
            console.log(chalk.yellow('ℹ️  Not currently logged in'));
            return;
        }

        if (options.interactive !== false && !options.force) {
            p.intro(chalk.inverse(' Logout '));

            const shouldLogout = await p.confirm({
                message: 'Are you sure you want to logout?',
                initialValue: false,
            });

            if (p.isCancel(shouldLogout) || !shouldLogout) {
                p.cancel('Logout cancelled');
                return;
            }
        }

        await removeAuth();
        console.log(chalk.green('✅ Successfully logged out'));
        logger.info('User logged out');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`❌ Logout failed: ${errorMessage}`));
        process.exit(1);
    }
}

/**
 * Show current authentication status
 */
export async function handleStatusCommand(): Promise<void> {
    const auth = await loadAuth();

    if (!auth) {
        console.log(chalk.yellow('❌ Not logged in'));
        console.log(chalk.dim('Run `dexto login` to authenticate'));
        return;
    }

    console.log(chalk.green('✅ Logged in'));

    if (auth.email) {
        console.log(chalk.dim(`Email: ${auth.email}`));
    }

    if (auth.userId) {
        console.log(chalk.dim(`User ID: ${auth.userId}`));
    }

    if (auth.expiresAt) {
        const expiresDate = new Date(auth.expiresAt);
        console.log(chalk.dim(`Expires: ${expiresDate.toLocaleDateString()}`));
    }
}
