// packages/cli/src/cli/commands/billing/status.ts

import chalk from 'chalk';
import { loadAuth } from '../../auth/index.js';

/**
 * Handle the `dexto billing status` command.
 * Shows Dexto account billing information.
 *
 * Currently shows auth status and points to web dashboard.
 * Future: Will fetch and display actual balance via API.
 */
export async function handleBillingStatusCommand(): Promise<void> {
    const auth = await loadAuth();

    if (!auth) {
        console.log(chalk.yellow('❌ Not logged in to Dexto'));
        console.log(chalk.dim('Run `dexto login` to authenticate'));
        return;
    }

    console.log(chalk.green('✅ Logged in to Dexto'));

    if (auth.email) {
        console.log(chalk.dim(`Account: ${auth.email}`));
    }

    console.log();
    console.log(chalk.cyan('📊 Billing Information'));
    console.log(chalk.dim('View your balance and usage at:'));
    console.log(chalk.blue('  https://dexto.ai/billing'));
    console.log();
    console.log(chalk.dim('To top up credits, visit:'));
    console.log(chalk.blue('  https://dexto.ai/billing/top-up'));
}
