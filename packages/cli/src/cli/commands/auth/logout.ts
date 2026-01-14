// packages/cli/src/cli/commands/auth/logout.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { isAuthenticated, removeAuth } from '../../auth/index.js';
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
