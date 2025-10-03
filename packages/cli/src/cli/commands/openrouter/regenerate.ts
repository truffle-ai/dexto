// packages/cli/src/cli/commands/openrouter/regenerate.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getDextoApiClient } from '../../utils/dexto-api-client.js';
import { getAuthToken, isAuthenticated, loadAuth, storeAuth } from '../../utils/auth-service.js';

export async function handleOpenRouterRegenerateCommand(): Promise<void> {
    try {
        p.intro(chalk.inverse(' Regenerate OpenRouter Key '));

        if (!(await isAuthenticated())) {
            console.log(chalk.red('❌ Not authenticated. Please run `dexto login` first.'));
            return;
        }

        const shouldRegenerate = await p.confirm({
            message:
                'This will create a new OpenRouter API key and invalidate the old one. Continue?',
            initialValue: false,
        });

        if (p.isCancel(shouldRegenerate) || !shouldRegenerate) {
            p.cancel('Regeneration cancelled');
            return;
        }

        console.log(chalk.cyan('🔄 Regenerating OpenRouter API key...'));

        const authToken = await getAuthToken();

        if (!authToken) {
            throw new Error('No authentication token found');
        }

        const apiClient = await getDextoApiClient();
        const { apiKey, keyId } = await apiClient.provisionOpenRouterKey(authToken);

        const auth = await loadAuth();
        if (auth) {
            await storeAuth({
                ...auth,
                openRouterApiKey: apiKey,
                openRouterKeyId: keyId,
            });
        }

        console.log(chalk.green('✅ OpenRouter API key regenerated successfully!'));
        console.log(chalk.dim(`   New Key ID: ${keyId}`));

        p.outro(chalk.green('New OpenRouter key is ready to use!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Failed to regenerate OpenRouter key: ${errorMessage}`));
        process.exit(1);
    }
}
