// packages/cli/src/cli/commands/billing/status.ts

import chalk from 'chalk';
import open from 'open';
import { loadAuth, getDextoApiClient } from '../../auth/index.js';
import { DEXTO_CREDITS_URL } from '../../auth/constants.js';

/**
 * Handle the `dexto billing` command.
 * Shows Dexto account billing information including balance and usage.
 */
export async function handleBillingStatusCommand(options: { buy?: boolean } = {}): Promise<void> {
    const auth = await loadAuth();

    if (!auth) {
        console.log(chalk.yellow('❌ Not logged in to Dexto'));
        console.log(chalk.dim('Run `dexto login` to authenticate'));
        if (options.buy) {
            await openCreditsPage();
        }
        return;
    }

    if (!auth.dextoApiKey) {
        console.log(chalk.yellow('❌ No Dexto API key found'));
        console.log(chalk.dim('Run `dexto login` to provision an API key'));
        if (options.buy) {
            await openCreditsPage();
        }
        return;
    }

    console.log(chalk.green('✅ Logged in to Dexto'));

    if (auth.email) {
        console.log(chalk.dim(`Account: ${auth.email}`));
    }

    console.log();

    try {
        const apiClient = getDextoApiClient();
        const usage = await apiClient.getUsageSummary(auth.dextoApiKey);

        // Display balance
        console.log(chalk.cyan('💰 Balance'));
        console.log(`   ${chalk.bold('$' + usage.credits_usd.toFixed(2))} remaining`);
        console.log(chalk.dim(`   Buy more credits: run ${chalk.cyan('dexto billing --buy')}`));
        console.log();

        // Display month-to-date usage
        console.log(chalk.cyan('📊 This Month'));
        console.log(`   Spent: ${chalk.yellow('$' + usage.mtd_usage.total_cost_usd.toFixed(4))}`);
        console.log(`   Requests: ${chalk.yellow(usage.mtd_usage.total_requests.toString())}`);

        // Show usage by model if there's any
        const modelEntries = Object.entries(usage.mtd_usage.by_model);
        if (modelEntries.length > 0) {
            console.log();
            console.log(chalk.cyan('📈 Usage by Model'));
            for (const [model, stats] of modelEntries) {
                console.log(
                    `   ${chalk.dim(model)}: $${stats.cost_usd.toFixed(4)} (${stats.requests} requests)`
                );
            }
        }

        // Show recent usage if any
        if (usage.recent.length > 0) {
            console.log();
            console.log(chalk.cyan('🕐 Recent Activity'));
            for (const entry of usage.recent.slice(0, 5)) {
                const date = new Date(entry.timestamp).toLocaleString();
                console.log(
                    `   ${chalk.dim(date)} - ${entry.model}: $${entry.cost_usd.toFixed(4)}`
                );
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`❌ Failed to fetch billing info: ${errorMessage}`));
        console.log(chalk.dim('Your API key may be invalid. Try `dexto login` to refresh.'));
        if (options.buy) {
            await openCreditsPage();
        }
    }

    if (options.buy) {
        await openCreditsPage();
    }
}

async function openCreditsPage(): Promise<void> {
    try {
        await open(DEXTO_CREDITS_URL);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.yellow(`⚠️  Unable to open browser: ${errorMessage}`));
        console.log(chalk.dim(`Open this link to buy credits: ${DEXTO_CREDITS_URL}`));
    }
}
