// packages/cli/src/cli/utils/login-flow.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { logger } from '@dexto/core';
import { createInitialPreferences, saveGlobalPreferences } from '@dexto/core';
import { getPrimaryApiKeyEnvVar } from '@dexto/core';
import { handleBrowserLogin } from '../commands/auth.js';
import { setupOpenRouterIfAvailable } from './openrouter-setup.js';

/**
 * Complete login flow that handles authentication, key provisioning, and configuration
 */
export async function handleCompleteLoginFlow(): Promise<void> {
    try {
        p.intro(chalk.cyan('🚀 Dexto Login Setup'));

        // Show login details and get confirmation
        const { showLoginDetails } = await import('./welcome-flow.js');
        const shouldContinue = await showLoginDetails();

        if (!shouldContinue) {
            return;
        }

        // Start the login process
        const spinner = p.spinner();
        spinner.start('Starting authentication...');

        try {
            // Perform browser-based OAuth login
            await handleBrowserLogin();

            // Configure OpenRouter environment
            spinner.message('Configuring OpenRouter access...');
            const openRouterConfigured = await setupOpenRouterIfAvailable();

            if (!openRouterConfigured) {
                spinner.stop(chalk.yellow('⚠️  OpenRouter configuration failed'));
                throw new Error('Failed to configure OpenRouter access');
            }

            // Set up default preferences for logged-in user
            spinner.message('Setting up preferences...');
            await setupDefaultPreferences();

            spinner.stop(chalk.green('✅ Login setup complete!'));

            p.outro(chalk.green("🎉 You're all set! Dexto is configured with OpenRouter."));
            console.log(
                chalk.dim('\n💡 You can now use any OpenRouter model in your agent configs.')
            );
            console.log(chalk.dim('   Example: model: openai/gpt-4o'));
            console.log(chalk.dim('\n🚀 Run `dexto` to start chatting!'));
        } catch (error) {
            spinner.stop(chalk.red('❌ Login setup failed'));
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`Error: ${errorMessage}`));
            throw error;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ Login setup failed: ${errorMessage}`));
        process.exit(1);
    }
}

/**
 * Sets up default preferences for a logged-in user
 */
async function setupDefaultPreferences(): Promise<void> {
    try {
        // Create preferences for OpenRouter with a popular model
        const preferences = createInitialPreferences(
            'openai-compatible',
            'openai/gpt-4o-mini',
            getPrimaryApiKeyEnvVar('openai-compatible'),
            'default-agent'
        );

        await saveGlobalPreferences(preferences);
        logger.debug('Default preferences set for logged-in user');
    } catch (error) {
        logger.warn(`Failed to set default preferences: ${error}`);
        // Don't throw - this shouldn't block the login process
    }
}
