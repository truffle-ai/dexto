// packages/cli/src/cli/commands/auth/logout.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    isAuthenticated,
    loadAuth,
    removeAuth,
    removeDextoApiKeyFromEnv,
} from '../../auth/index.js';
import { isUsingDextoCredits } from '../../../config/effective-llm.js';
import { logger } from '@dexto/core';

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

        // Check if user is configured to use Dexto credits
        // Uses getEffectiveLLMConfig() to check all config layers
        const usingDextoCredits = await isUsingDextoCredits();

        if (options.interactive !== false && !options.force) {
            p.intro(chalk.inverse(' Logout '));

            // Warn if using Dexto credits
            if (usingDextoCredits) {
                console.log(
                    chalk.yellow(
                        '\n⚠️  You are currently configured to use Dexto Nova credits (provider: Dexto Nova)'
                    )
                );
                console.log(
                    chalk.dim('   After logout, you will need to run `dexto setup` to configure')
                );
                console.log(
                    chalk.dim('   a different provider, or `dexto login` to log back in.\n')
                );
            }

            const shouldLogout = await p.confirm({
                message: usingDextoCredits
                    ? 'Logout will disable Dexto Nova credits. Continue?'
                    : 'Are you sure you want to logout?',
                initialValue: false,
            });

            if (p.isCancel(shouldLogout) || !shouldLogout) {
                p.cancel('Logout cancelled');
                return;
            }
        }

        let provisionedApiKey: string | null = null;
        const auth = await loadAuth();
        if (auth?.dextoApiKey && auth.dextoApiKeySource === 'provisioned') {
            provisionedApiKey = auth.dextoApiKey;
        }

        await removeAuth();
        if (provisionedApiKey) {
            await removeDextoApiKeyFromEnv({ expectedValue: provisionedApiKey });
        }

        console.log(chalk.green('✅ Successfully logged out'));

        if (usingDextoCredits) {
            console.log();
            console.log(chalk.cyan('Next steps:'));
            console.log(chalk.dim('  • Run `dexto login` to log back in'));
            console.log(chalk.dim('  • Or run `dexto setup` to configure a different provider'));
        }

        logger.info('User logged out');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`❌ Logout failed: ${errorMessage}`));
        // Re-throw to let CLI wrapper handle exit and analytics tracking
        throw error;
    }
}
