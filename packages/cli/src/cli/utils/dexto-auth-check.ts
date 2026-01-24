// packages/cli/src/cli/utils/dexto-auth-check.ts
/**
 * Dexto Authentication Check
 *
 * Validates that users configured to use Dexto credits are properly authenticated.
 * This prevents the confusing state where user is logged out but still has
 * Dexto credits configured (which would fail at runtime).
 *
 * ## When This Check Runs
 *
 * - On CLI startup, after loading preferences
 * - Before attempting to use the LLM
 *
 * ## Why This Exists
 *
 * When a user runs `dexto logout` while configured with `provider: dexto`,
 * their preferences.yml still points to Dexto. Without this check, the CLI
 * would attempt to use Dexto credits and fail with "Invalid API key" errors.
 *
 * Instead, we catch this state early and offer clear options:
 * - Log back in to continue using Dexto credits
 * - Run setup to configure a different provider (BYOK)
 *
 * @module dexto-auth-check
 */

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { isAuthenticated } from '../auth/index.js';
import { getEffectiveLLMConfig, type EffectiveLLMConfig } from '../../config/effective-llm.js';

export interface DextoAuthCheckResult {
    shouldContinue: boolean;
    action?: 'login' | 'setup' | 'cancel';
}

/**
 * Check if user is configured to use Dexto credits but is not authenticated.
 * This can happen if user logged out after setting up with Dexto credits.
 *
 * Uses getEffectiveLLMConfig() to determine the actual LLM that will be used,
 * considering all config layers (local, preferences, bundled).
 *
 * @param interactive Whether to show interactive prompts
 * @param agentId Agent to check config for (default: 'coding-agent')
 * @returns Whether to continue startup and what action was taken
 *
 * @example
 * ```typescript
 * const result = await checkDextoAuthState(true, 'coding-agent');
 * if (!result.shouldContinue) {
 *   if (result.action === 'login') {
 *     await handleLoginCommand();
 *   } else if (result.action === 'setup') {
 *     await handleSetupCommand();
 *   }
 * }
 * ```
 */
export async function checkDextoAuthState(
    interactive: boolean = true,
    agentId: string = 'coding-agent'
): Promise<DextoAuthCheckResult> {
    // Get the effective LLM config considering all layers
    const effectiveLLM = await getEffectiveLLMConfig({ agentId });

    // Not using dexto provider - nothing to check
    if (!effectiveLLM || effectiveLLM.provider !== 'dexto') {
        return { shouldContinue: true };
    }

    // Using dexto provider - check if authenticated
    const authenticated = await isAuthenticated();
    if (authenticated) {
        return { shouldContinue: true };
    }

    // User is configured for Dexto credits but not logged in
    if (!interactive) {
        // Non-interactive mode - just show error and exit
        console.log(chalk.red('\n❌ You are configured to use Dexto credits but not logged in.\n'));
        console.log(chalk.dim('Your preferences have provider: dexto, but no active session.\n'));
        console.log(chalk.bold('To fix this:'));
        console.log(
            chalk.cyan('  • dexto login') + chalk.dim('  - Log back in to use Dexto credits')
        );
        console.log(
            chalk.cyan('  • dexto setup') + chalk.dim('  - Configure a different provider (BYOK)')
        );
        console.log();
        return { shouldContinue: false, action: 'cancel' };
    }

    // Interactive mode - prompt user
    console.log(chalk.yellow('\n⚠️  Dexto Authentication Required\n'));
    console.log(chalk.dim('You are configured to use Dexto credits (provider: dexto)'));
    console.log(chalk.dim('but you are not currently logged in.\n'));

    const action = await p.select({
        message: 'How would you like to proceed?',
        options: [
            {
                value: 'login' as const,
                label: 'Log in to Dexto',
                hint: 'Authenticate to use Dexto credits',
            },
            {
                value: 'setup' as const,
                label: 'Configure a different provider',
                hint: 'Set up your own API key (BYOK)',
            },
            {
                value: 'cancel' as const,
                label: 'Exit',
                hint: 'Cancel and exit',
            },
        ],
    });

    if (p.isCancel(action) || action === 'cancel') {
        return { shouldContinue: false, action: 'cancel' };
    }

    return { shouldContinue: false, action };
}
