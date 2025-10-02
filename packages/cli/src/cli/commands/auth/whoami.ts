// packages/cli/src/cli/commands/auth/whoami.ts

import chalk from 'chalk';
import { loadAuth } from '../../utils/auth-service.js';

export async function handleWhoamiCommand(): Promise<void> {
    const auth = await loadAuth();

    if (!auth) {
        console.log(chalk.red('Not authenticated'));
        console.log(chalk.dim('Run `dexto login` to authenticate'));
        process.exit(1);
    }

    if (auth.email) {
        console.log(chalk.cyan(auth.email));
    } else if (auth.userId) {
        console.log(chalk.cyan(auth.userId));
    } else {
        console.log(chalk.cyan('Authenticated user'));
    }

    const details: string[] = [];

    if (auth.userId && auth.email) {
        details.push(`ID: ${auth.userId}`);
    }

    if (auth.expiresAt) {
        const expiresDate = new Date(auth.expiresAt);
        const now = new Date();
        const daysUntilExpiry = Math.ceil(
            (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntilExpiry > 0) {
            details.push(
                `Token expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}`
            );
        } else {
            details.push(chalk.red('Token expired'));
        }
    }

    if (details.length > 0) {
        console.log(chalk.dim(`(${details.join(', ')})`));
    }
}
