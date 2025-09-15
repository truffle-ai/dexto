// packages/cli/src/cli/utils/api-key-setup.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { LLMProvider } from '@dexto/core';
import {
    logger,
    getPrimaryApiKeyEnvVar,
    getExecutionContext,
    saveProviderApiKey,
    applyLayeredEnvironmentLoading,
} from '@dexto/core';
import {
    getProviderDisplayName,
    isValidApiKeyFormat,
    getProviderInstructions,
} from './provider-setup.js';

/**
 * Interactively prompts the user to set up an API key for a specific provider.
 * Used when config validation detects a missing API key for a configured provider.
 * Only handles environment variable setup - does not modify config files.
 * Exits the process if user cancels or setup fails.
 * @param provider - The specific provider that needs API key setup
 */
export async function interactiveApiKeySetup(provider: LLMProvider): Promise<void> {
    try {
        // Welcome message
        p.intro(chalk.cyan('🔑 API Key Setup '));

        // Show targeted message for the required provider
        const instructions = getProviderInstructions(provider);
        p.note(
            `Your configuration requires a ${getProviderDisplayName(provider)} API key.\n\n` +
                (instructions ? instructions.content : 'Please get an API key for this provider.'),
            chalk.bold(`${getProviderDisplayName(provider)} API Key Required`)
        );

        // First, ask what they want to do
        const options = [
            {
                value: 'setup',
                label: 'Set up an API key now',
                hint: 'Interactive setup (recommended)',
            },
            {
                value: 'manual',
                label: 'Set up manually later',
                hint: 'Get instructions for manual setup',
            },
            {
                value: 'exit',
                label: 'Exit',
                hint: 'Quit Dexto for now',
            },
        ];

        // Add OpenRouter login option if provider is openai-compatible
        if (provider === 'openai-compatible') {
            options.unshift({
                value: 'login',
                label: '🚀 Login with OpenRouter (Automatic)',
                hint: 'No API key needed - automatic setup',
            });
        }

        const action = await p.select({
            message: 'What would you like to do?',
            options,
        });

        if (action === 'exit') {
            p.cancel('Setup cancelled. Run dexto again when you have an API key!');
            process.exit(0);
        }

        if (action === 'manual') {
            showManualSetupInstructions(provider);
            console.log(chalk.dim('\n👋 Run dexto again once you have set up your API key!'));
            process.exit(0);
        }

        if (action === 'login') {
            // Handle OpenRouter login flow
            await handleOpenRouterLogin();
            return; // Exit successfully after login
        }

        if (p.isCancel(action)) {
            p.cancel('Setup cancelled');
            process.exit(1);
        }

        const apiKey = await p.password({
            message: `Enter your ${getProviderDisplayName(provider)} API key`,
            mask: '*',
            validate: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'API key is required';
                }
                if (!isValidApiKeyFormat(value.trim(), provider)) {
                    return `Invalid ${getProviderDisplayName(provider)} API key format`;
                }
                return undefined;
            },
        });

        if (p.isCancel(apiKey)) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }

        // Update .env file
        const spinner = p.spinner();
        spinner.start('Saving API key...');

        try {
            // Update .env file with the API key using smart path detection
            const meta = await saveProviderApiKey(provider, apiKey.trim(), process.cwd());
            spinner.stop(
                `✨ API key saved successfully for ${getProviderDisplayName(provider)} in ${meta.targetEnvPath}!`
            );

            p.outro(chalk.green(`✨ API key setup complete!`));

            // Reload environment variables so the newly saved API key is available
            await applyLayeredEnvironmentLoading();
        } catch (error) {
            spinner.stop('Failed to save API key');
            logger.error(`Failed to update .env file: ${error}`);

            // Provide context-aware manual setup instructions
            let instructions: string;

            if (getExecutionContext() === 'global-cli') {
                instructions =
                    `1. Create ~/.dexto/.env file\n` +
                    `2. Add this line: ${getPrimaryApiKeyEnvVar(provider)}=your_api_key_here\n` +
                    `3. Run dexto again\n\n` +
                    `Alternatively:\n` +
                    `• Set environment variable: export ${getPrimaryApiKeyEnvVar(provider)}=your_api_key_here\n` +
                    `• Or run: dexto setup`;
            } else {
                instructions =
                    `1. Create a .env file in your project root\n` +
                    `2. Add this line: ${getPrimaryApiKeyEnvVar(provider)}=your_api_key_here\n` +
                    `3. Run dexto again`;
            }

            p.note(
                `Manual setup required:\n\n${instructions}`,
                chalk.yellow('Save this API key manually')
            );
            console.error(chalk.red('\n❌ API key setup required to continue.'));
            process.exit(1);
        }
    } catch (error) {
        if (p.isCancel(error)) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }
        console.error(chalk.red('\n❌ API key setup required to continue.'));
        process.exit(1);
    }
}

/**
 * Shows manual setup instructions to the user
 */
function showManualSetupInstructions(provider: LLMProvider): void {
    const envVar = getPrimaryApiKeyEnvVar(provider);
    const envInstructions =
        getExecutionContext() === 'global-cli'
            ? [
                  `${chalk.bold('2. Recommended: Use dexto setup (easiest):')}`,
                  `   dexto setup`,
                  ``,
                  `${chalk.bold('Or manually create ~/.dexto/.env:')}`,
                  `   mkdir -p ~/.dexto && echo "${envVar}=your_api_key_here" > ~/.dexto/.env`,
              ]
            : [
                  `${chalk.bold('2. Create a .env file in your project:')}`,
                  `   echo "${envVar}=your_api_key_here" > .env`,
              ];

    const instructions = [
        `${chalk.bold('1. Get an API key:')}`,
        `   • ${chalk.green('Google Gemini (Free)')}:  https://aistudio.google.com/apikey`,
        `   • ${chalk.blue('OpenAI')}:           https://platform.openai.com/api-keys`,
        `   • ${chalk.magenta('Anthropic')}:        https://console.anthropic.com/settings/keys`,
        `   • ${chalk.yellow('Groq (Free)')}:      https://console.groq.com/keys`,
        ``,
        ...envInstructions,
        `   # OR for other providers:`,
        `   # OPENAI_API_KEY=your_key_here`,
        `   # ANTHROPIC_API_KEY=your_key_here`,
        `   # GROQ_API_KEY=your_key_here`,
        ``,
        `${chalk.bold('3. Run dexto again:')}`,
        `   dexto | npx dexto`,
        ``,
        `${chalk.dim('💡 Tip: Start with Google Gemini for a free experience!')}`,
    ].join('\n');

    p.note(instructions, chalk.bold('Manual Setup Instructions'));
}

/**
 * Handles OpenRouter login flow - login → provision → configure
 */
async function handleOpenRouterLogin(): Promise<void> {
    try {
        // Import login functionality
        const { handleLoginCommand } = await import('../commands/auth.js');

        p.intro(chalk.cyan('🚀 OpenRouter Login'));

        p.note(
            'This will:\n' +
                '1. Open your browser for authentication\n' +
                '2. Automatically provision an OpenRouter API key\n' +
                '3. Configure Dexto to use OpenRouter models\n' +
                '4. Start chatting immediately!',
            'Automatic Setup Process'
        );

        const shouldContinue = await p.confirm({
            message: 'Continue with OpenRouter login?',
            initialValue: true,
        });

        if (p.isCancel(shouldContinue) || !shouldContinue) {
            p.cancel('OpenRouter login cancelled');
            process.exit(0);
        }

        // Start the login process
        const spinner = p.spinner();
        spinner.start('Starting OpenRouter login...');

        try {
            // Call the browser login directly to avoid conflicting prompts
            const { handleBrowserLogin } = await import('../commands/auth.js');
            await handleBrowserLogin();

            // Configure environment variables for OpenRouter
            spinner.message('Configuring OpenRouter environment...');
            await configureOpenRouterEnvironment();

            spinner.stop(chalk.green('✅ OpenRouter setup complete!'));

            p.outro(chalk.green("🎉 You're all set! Dexto is configured with OpenRouter."));
            console.log(
                chalk.dim('\n💡 You can now use any OpenRouter model in your agent configs.')
            );
            console.log(chalk.dim('   Example: model: openai/gpt-4o'));
        } catch (error) {
            spinner.stop(chalk.red('❌ OpenRouter login failed'));
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`Error: ${errorMessage}`));
            process.exit(1);
        }
    } catch (error) {
        console.error(chalk.red('\n❌ OpenRouter login setup failed.'));
        process.exit(1);
    }
}

/**
 * Configures environment variables for OpenRouter after successful login
 */
async function configureOpenRouterEnvironment(): Promise<void> {
    try {
        // Import the OpenRouter setup utility
        const { setupOpenRouterIfAvailable } = await import('./openrouter-setup.js');

        // This will set up the environment variables using the provisioned key
        const success = await setupOpenRouterIfAvailable();

        if (!success) {
            throw new Error('Failed to configure OpenRouter environment variables');
        }
    } catch (error) {
        logger.error(`Failed to configure OpenRouter environment: ${error}`);
        throw error;
    }
}
