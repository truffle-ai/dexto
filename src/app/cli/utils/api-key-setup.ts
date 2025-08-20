// src/app/cli/utils/api-key-setup.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { LLMProvider, logger } from '@core/index.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { getDextoEnvPath } from '@core/utils/path.js';
import { getExecutionContext } from '@core/utils/execution-context.js';
import { updateEnvFileWithLLMKeys } from './env-utils.js';
import { applyLayeredEnvironmentLoading } from '@core/utils/env.js';
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
        const action = await p.select({
            message: 'What would you like to do?',
            options: [
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
            ],
        });

        if (action === 'exit') {
            p.cancel('Setup cancelled. Run dexto again when you have an API key!');
            process.exit(0);
        }

        if (action === 'manual') {
            showManualSetupInstructions();
            console.log(chalk.dim('\n👋 Run dexto again once you have set up your API key!'));
            process.exit(0);
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
                    throw new Error(`Invalid ${getProviderDisplayName(provider)} API key format`);
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
            const envFilePath = getDextoEnvPath(process.cwd());
            await updateEnvFileWithLLMKeys(envFilePath, provider, apiKey.trim());
            spinner.stop(
                `✨ API key saved successfully for ${getProviderDisplayName(provider)} in ${envFilePath}!`
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
                    `2. Add this line: ${getPrimaryApiKeyEnvVar(provider)}=${apiKey}\n` +
                    `3. Run dexto again\n\n` +
                    `Alternatively:\n` +
                    `• Set environment variable: export ${getPrimaryApiKeyEnvVar(provider)}=${apiKey}\n` +
                    `• Or run: dexto setup`;
            } else {
                instructions =
                    `1. Create a .env file in your project root\n` +
                    `2. Add this line: ${getPrimaryApiKeyEnvVar(provider)}=${apiKey}\n` +
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
function showManualSetupInstructions(): void {
    const envInstructions =
        getExecutionContext() === 'global-cli'
            ? [
                  `${chalk.bold('2. Recommended: Use dexto setup (easiest):')}`,
                  `   dexto setup`,
                  ``,
                  `${chalk.bold('Or manually create ~/.dexto/.env:')}`,
                  `   mkdir -p ~/.dexto && echo "GOOGLE_GENERATIVE_AI_API_KEY=your_key_here" > ~/.dexto/.env`,
              ]
            : [
                  `${chalk.bold('2. Create a .env file in your project:')}`,
                  `   echo "GOOGLE_GENERATIVE_AI_API_KEY=your_key_here" > .env`,
              ];

    const instructions = [
        `${chalk.bold('1. Get an API key:')}`,
        `   • ${chalk.green('Google Gemini (Free)')}:  https://aistudio.google.com/apikey`,
        `   • ${chalk.blue('OpenAI')}:           https://platform.openai.com/api-keys`,
        `   • ${chalk.magenta('Anthropic')}:        https://console.anthropic.com/keys`,
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
