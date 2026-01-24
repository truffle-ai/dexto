// packages/cli/src/cli/utils/dexto-auth-check.ts
// Check if user is configured for Dexto credits but not authenticated

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { isAuthenticated } from '../auth/index.js';
import type { GlobalPreferences } from '@dexto/agent-management';

export interface DextoAuthCheckResult {
    shouldContinue: boolean;
    action?: 'login' | 'setup' | 'cancel';
}

/**
 * Check if user is configured to use Dexto credits but is not authenticated.
 * This can happen if user logged out after setting up with Dexto credits.
 *
 * @param preferences User's global preferences
 * @param interactive Whether to show interactive prompts
 * @returns Whether to continue startup and what action was taken
 */
export async function checkDextoAuthState(
    preferences: GlobalPreferences | null,
    interactive: boolean = true
): Promise<DextoAuthCheckResult> {
    // No preferences or not using dexto provider - nothing to check
    if (!preferences?.llm || preferences.llm.provider !== 'dexto') {
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
