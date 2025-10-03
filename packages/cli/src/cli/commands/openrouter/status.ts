// packages/cli/src/cli/commands/openrouter/status.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getOpenRouterApiKey, isAuthenticated } from '../../utils/auth-service.js';

export async function handleOpenRouterStatusCommand(): Promise<void> {
    try {
        p.intro(chalk.inverse(' OpenRouter Status '));

        if (!(await isAuthenticated())) {
            console.log(chalk.red('❌ Not authenticated. Please run `dexto login` first.'));
            return;
        }

        const openRouterKey = await getOpenRouterApiKey();

        if (!openRouterKey) {
            console.log(chalk.yellow('⚠️  No OpenRouter API key found.'));
            console.log(
                chalk.dim('   Run `dexto login` to automatically provision an OpenRouter API key.')
            );
            return;
        }

        console.log(chalk.green('✅ OpenRouter API key is configured'));
        console.log(chalk.dim(`   Key: ${openRouterKey.substring(0, 20)}...`));
        console.log(chalk.dim('   You can use all OpenRouter models without manual setup'));

        p.outro(chalk.green('OpenRouter is ready to use!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Failed to check OpenRouter status: ${errorMessage}`));
        process.exit(1);
    }
}
