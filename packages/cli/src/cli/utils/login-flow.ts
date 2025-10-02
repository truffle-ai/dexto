// packages/cli/src/cli/utils/login-flow.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { logger } from '@dexto/core';
import { createInitialPreferences, saveGlobalPreferences } from '@dexto/core';
import { getPrimaryApiKeyEnvVar } from '@dexto/core';
import { writePreferencesToAgent } from '@dexto/core';
import { handleBrowserLogin } from '../commands/auth/login.js';
import { setupOpenRouterIfAvailable, OPENROUTER_CONFIG } from './openrouter-setup.js';

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

        try {
            // Perform browser-based OAuth login (handles its own UI)
            await handleBrowserLogin();

            // Configure OpenRouter environment
            const spinner = p.spinner();
            spinner.start('Configuring OpenRouter access...');
            const openRouterConfigured = await setupOpenRouterIfAvailable();

            if (!openRouterConfigured) {
                spinner.stop(chalk.yellow('⚠️  OpenRouter configuration failed'));
                throw new Error('Failed to configure OpenRouter access');
            }

            // Set up default preferences for logged-in user
            spinner.message('Setting up preferences...');
            const preferences = await setupDefaultPreferences();

            // Apply preferences to existing agent configs
            spinner.message('Updating agent configurations...');
            await applyPreferencesToAgents(preferences);

            spinner.stop(chalk.green('✅ Login setup complete!'));

            p.outro(chalk.green("🎉 You're all set! Dexto is configured with OpenRouter."));
            console.log(
                chalk.dim('\n💡 You can now use any OpenRouter model in your agent configs.')
            );
            console.log(chalk.dim('   Example: model: openai/gpt-4o'));
            console.log(chalk.dim('\n🚀 Run `dexto` to start chatting!'));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`\n❌ Login setup failed: ${errorMessage}`));
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
async function setupDefaultPreferences() {
    try {
        // Create preferences for OpenRouter with a popular model
        const preferences = createInitialPreferences(
            'openrouter',
            'openai/gpt-4o-mini',
            getPrimaryApiKeyEnvVar('openrouter'),
            'default-agent'
        );

        await saveGlobalPreferences(preferences);
        logger.debug('Default preferences set for logged-in user');
        return preferences;
    } catch (error) {
        logger.warn(`Failed to set default preferences: ${error}`);
        // Don't throw - this shouldn't block the login process
        return null;
    }
}

/**
 * Applies preferences to existing agent configurations
 */
async function applyPreferencesToAgents(preferences: any): Promise<void> {
    if (!preferences) {
        logger.warn('No preferences to apply to agents');
        return;
    }

    try {
        // Find and update the default agent config
        const { getDextoGlobalPath } = await import('@dexto/core');
        const defaultAgentPath = getDextoGlobalPath('agents/default-agent.yml');

        // Check if default agent exists
        const fs = await import('fs/promises');
        try {
            await fs.access(defaultAgentPath);
            await writePreferencesToAgent(defaultAgentPath, preferences);
            logger.debug('Applied preferences to default agent');
        } catch (error) {
            logger.debug('Default agent not found, skipping preference application');
        }

        // TODO: In the future, we could also update other installed agents
        // For now, we focus on the default agent which is the most common use case
    } catch (error) {
        logger.warn(`Failed to apply preferences to agents: ${error}`);
        // Don't throw - this shouldn't block the login process
    }
}
