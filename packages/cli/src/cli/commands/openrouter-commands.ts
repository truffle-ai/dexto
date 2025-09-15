// packages/cli/src/cli/commands/openrouter-commands.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getOpenRouterApiKey, isAuthenticated } from './auth.js';
import { getDextoApiClient } from '../utils/dexto-api-client.js';

/**
 * Show OpenRouter API key status
 */
export async function handleOpenRouterStatusCommand(): Promise<void> {
    try {
        p.intro(chalk.inverse(' OpenRouter Status '));

        // Check if user is authenticated
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

/**
 * Regenerate OpenRouter API key
 */
export async function handleOpenRouterRegenerateCommand(): Promise<void> {
    try {
        p.intro(chalk.inverse(' Regenerate OpenRouter Key '));

        // Check if user is authenticated
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

        // Get auth token
        const { getAuthToken } = await import('./auth.js');
        const authToken = await getAuthToken();

        if (!authToken) {
            throw new Error('No authentication token found');
        }

        // Call API to regenerate key
        const apiClient = await getDextoApiClient();
        const { apiKey, keyId } = await apiClient.provisionOpenRouterKey(authToken);

        // Update stored auth config
        const { loadAuth, storeAuth } = await import('./auth.js');
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

/**
 * Show available OpenRouter models
 */
export async function handleOpenRouterModelsCommand(): Promise<void> {
    try {
        p.intro(chalk.inverse(' OpenRouter Models '));

        // Check if user is authenticated and has OpenRouter key
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

        console.log(chalk.green('✅ OpenRouter API key found'));
        console.log(chalk.dim('\nPopular OpenRouter models you can use:'));

        const popularModels = [
            'openai/gpt-4o',
            'openai/gpt-4o-mini',
            'anthropic/claude-3-5-sonnet-20241022',
            'anthropic/claude-3-5-haiku-20241022',
            'google/gemini-2.0-flash-exp',
            'meta-llama/llama-3.1-8b-instant',
            'meta-llama/llama-3.1-70b-instant',
            'mistralai/mistral-7b-instruct',
            'mistralai/mixtral-8x7b-instruct',
        ];

        popularModels.forEach((model, index) => {
            console.log(chalk.dim(`   ${index + 1}. ${model}`));
        });

        console.log(chalk.dim('\nTo use these models, configure your agent with:'));
        console.log(chalk.cyan('   provider: openai-compatible'));
        console.log(chalk.cyan('   router: vercel'));
        console.log(chalk.cyan('   baseURL: https://openrouter.ai/api/v1'));
        console.log(chalk.cyan('   model: <model-name>'));

        p.outro(chalk.green('OpenRouter models are ready to use!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Failed to show OpenRouter models: ${errorMessage}`));
        process.exit(1);
    }
}
