import * as p from '@clack/prompts';
import chalk from 'chalk';
import { LLMProvider, logger } from '@core/index.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import {
    updateEnvFileWithLLMKeys,
    getProviderDisplayName,
    getApiKeyPlaceholder,
    isValidApiKeyFormat,
    getProviderInstructions,
} from './api-key-utils.js';
import { getDextoEnvPath } from '@core/utils/path.js';

/**
 * Interactively prompts the user to set up an API key for a specific provider.
 * Used when config validation detects a missing API key for a configured provider.
 * Only handles environment variable setup - does not modify config files.
 * @param provider - The specific provider that needs API key setup
 */
export async function interactiveApiKeySetup(provider: LLMProvider): Promise<boolean> {
    try {
        // Welcome message
        p.intro(chalk.cyan('🔑 API Key Setup'));

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
            return false;
        }

        if (action === 'manual') {
            showManualSetupInstructions();
            console.log(chalk.dim('\n👋 Run dexto again once you have set up your API key!'));
            return false;
        }

        // Provider is already determined from config validation

        const apiKey = await p.text({
            message: `Enter your ${getProviderDisplayName(provider)} API key`,
            placeholder: getApiKeyPlaceholder(provider),
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
            return false;
        }

        // Update .env file and agent configuration
        const spinner = p.spinner();
        spinner.start('Saving API key and updating configuration...');

        try {
            // Update .env file with the API key using smart path detection
            const envFilePath = getDextoEnvPath(process.cwd());
            await updateEnvFileWithLLMKeys(envFilePath, provider, apiKey.trim());
            spinner.stop('API key saved successfully! ✨');

            // Can append this with information about where the API key was saved if needed later
            p.outro(
                chalk.green(
                    '🎉 API Key Setup complete for ' + getProviderDisplayName(provider) + '!'
                )
            );

            return true;
        } catch (error) {
            spinner.stop('Failed to save API key');
            logger.error(`Failed to update .env file: ${error}`);

            p.note(
                `Manual setup required:\n\n` +
                    `1. Create a .env file in your project root\n` +
                    `2. Add this line: ${getPrimaryApiKeyEnvVar(provider)}=${apiKey}\n` +
                    `3. Update your agent.yml llm.provider to "${provider}"\n` +
                    `4. Update your agent.yml llm.apiKey to "$${getPrimaryApiKeyEnvVar(provider)}"\n` +
                    `5. Run dexto again`,
                chalk.yellow('Save this API key manually')
            );
            console.error(chalk.red('\n❌ API key setup required to continue.'));
            return false;
        }
    } catch (error) {
        if (p.isCancel(error)) {
            p.cancel('Setup cancelled');
            return false;
        }
        console.error(chalk.red('\n❌ API key setup required to continue.'));
        throw error;
    }
}

/**
 * Shows manual setup instructions to the user
 */
function showManualSetupInstructions(): void {
    const instructions = [
        `${chalk.bold('1. Get an API key:')}`,
        `   • ${chalk.green('Google Gemini (Free)')}:  https://aistudio.google.com/apikey`,
        `   • ${chalk.blue('OpenAI')}:           https://platform.openai.com/api-keys`,
        `   • ${chalk.magenta('Anthropic')}:        https://console.anthropic.com/keys`,
        `   • ${chalk.yellow('Groq (Free)')}:      https://console.groq.com/keys`,
        ``,
        `${chalk.bold('2. Create a .env file in your project:')}`,
        `   echo "GOOGLE_GENERATIVE_AI_API_KEY=your_key_here" > .env`,
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
