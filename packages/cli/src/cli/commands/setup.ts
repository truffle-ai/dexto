// packages/cli/src/cli/commands/setup.ts

import chalk from 'chalk';
import { z } from 'zod';
import {
    getDefaultModelForProvider,
    LLM_PROVIDERS,
    isValidProviderModel,
    getSupportedModels,
} from '@dexto/core';
import { getPrimaryApiKeyEnvVar, resolveApiKeyForProvider } from '@dexto/core';
import { createInitialPreferences, saveGlobalPreferences } from '@dexto/core';
import { interactiveApiKeySetup } from '../utils/api-key-setup.js';
import { selectProvider } from '../utils/provider-setup.js';
import { requiresSetup } from '../utils/setup-utils.js';
import { handleWelcomeFlow } from '../utils/welcome-flow.js';
import { handleCompleteLoginFlow } from '../utils/login-flow.js';
import { isAuthenticated } from '../utils/auth-service.js';
import { setupOpenRouterIfAvailable, OPENROUTER_CONFIG } from '../utils/openrouter-setup.js';
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';
import { capture } from '../../analytics/index.js';

// Zod schema for setup command validation
const SetupCommandSchema = z
    .object({
        provider: z
            .enum(LLM_PROVIDERS)
            .optional()
            .describe('AI provider identifier to use for LLM calls'),
        model: z
            .string()
            .min(1, 'Model name cannot be empty')
            .optional()
            .describe('Preferred model name for the selected provider'),
        defaultAgent: z
            .string()
            .min(1, 'Default agent name cannot be empty')
            .default('default-agent')
            .describe('Registry agent id to use when none is specified'),
        interactive: z.boolean().default(true).describe('Enable interactive prompts'),
        force: z
            .boolean()
            .default(false)
            .describe('Overwrite existing setup when already configured'),
    })
    .strict()
    .superRefine((data, ctx) => {
        // Validate model against provider when both are provided
        if (data.provider && data.model) {
            if (!isValidProviderModel(data.provider, data.model)) {
                const supportedModels = getSupportedModels(data.provider);
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['model'],
                    message: `Model '${data.model}' is not supported by provider '${data.provider}'. Supported models: ${supportedModels.join(', ')}`,
                });
            }
        }
    });

export type CLISetupOptions = z.output<typeof SetupCommandSchema>;
export type CLISetupOptionsInput = z.input<typeof SetupCommandSchema>;

/**
 * Validate setup command options with comprehensive validation
 */
function validateSetupCommand(options: Partial<CLISetupOptionsInput>): CLISetupOptions {
    // Basic structure validation
    const validated = SetupCommandSchema.parse(options);

    // Business logic validation
    if (!validated.interactive && !validated.provider) {
        throw new Error('Provider required in non-interactive mode. Use --provider option.');
    }

    return validated;
}

export async function handleSetupCommand(options: Partial<CLISetupOptionsInput>): Promise<void> {
    // Validate command with Zod
    const validated = validateSetupCommand(options);
    logger.debug(`Validated setup command options: ${JSON.stringify(validated, null, 2)}`);

    // Check if setup is already complete and handle accordingly
    const needsSetup = await requiresSetup();

    if (!needsSetup) {
        // Setup is already complete - handle based on mode
        if (!validated.interactive) {
            // Non-interactive mode: require --force flag
            if (!validated.force) {
                console.error(chalk.red('❌ Setup is already complete.'));
                console.error(
                    chalk.dim(
                        '   Use --force to overwrite existing setup, or run in interactive mode for confirmation.'
                    )
                );
                process.exit(1);
            }

            logger.warn('Overwriting existing setup due to --force flag');
        } else {
            // Interactive mode: ask for confirmation
            p.intro(chalk.yellow('⚠️  Setup Already Complete'));

            p.note(
                'Dexto is already set up and configured.\n' +
                    'Re-running setup will overwrite your current preferences.',
                'Current Setup Detected'
            );

            const shouldContinue = await p.confirm({
                message: 'Do you want to continue and overwrite your current setup?',
                initialValue: false,
            });

            if (p.isCancel(shouldContinue) || !shouldContinue) {
                p.cancel('Setup cancelled. Your existing configuration remains unchanged.');
                process.exit(0);
            }

            p.log.warn('Proceeding with setup override...');
        }
    }

    console.log(chalk.cyan('\n🗿 Setting up Dexto...\n'));

    // Check if user is already logged in and can use OpenRouter
    if (validated.interactive && !validated.provider && (await isAuthenticated())) {
        console.log(chalk.green('✅ Already logged in!'));
        console.log(chalk.cyan('🔑 Setting up OpenRouter with your existing credentials...\n'));

        try {
            // Configure OpenRouter environment
            const openRouterConfigured = await setupOpenRouterIfAvailable();

            if (openRouterConfigured) {
                // Create preferences for OpenRouter
                const preferences = createInitialPreferences(
                    'openrouter',
                    'openai/gpt-4o-mini',
                    getPrimaryApiKeyEnvVar('openrouter'),
                    validated.defaultAgent
                );

                await saveGlobalPreferences(preferences);

                console.log(
                    chalk.green('\n✨ Setup complete! Dexto is configured with OpenRouter.\n')
                );
                console.log(chalk.dim('💡 You can now use any OpenRouter model in your agents.'));
                console.log(chalk.dim('   Example: model: openai/gpt-4o\n'));

                // Track successful auto-setup
                capture('dexto_setup', {
                    provider: 'openrouter',
                    model: 'openai/gpt-4o-mini',
                    hadApiKeyBefore: true,
                    setupMode: 'interactive',
                });

                return; // Setup complete
            }
        } catch (error) {
            logger.warn(`Failed to auto-configure OpenRouter: ${error}`);
            console.log(
                chalk.yellow(
                    '⚠️  Could not automatically configure OpenRouter. Proceeding with manual setup...\n'
                )
            );
            // Fall through to manual setup flow
        }
    }

    // Show welcome flow for interactive setup without specific provider
    if (validated.interactive && !validated.provider) {
        const welcomeChoice = await handleWelcomeFlow();

        if (welcomeChoice === 'login') {
            await handleCompleteLoginFlow();
            return; // Login flow handles complete setup
        } else if (welcomeChoice === 'exit') {
            p.cancel('Setup cancelled');
            process.exit(0);
        }
        // Continue with manual setup if 'manual' chosen
    }

    // Determine provider (interactive or from options)
    let provider = validated.provider;
    if (!provider) {
        provider = await selectProvider();
    }

    // Get model and API key details
    let model = validated.model;

    // For all providers, use the default model
    const defaultModel = getDefaultModelForProvider(provider);
    model = model || defaultModel || undefined;

    if (!model) {
        throw new Error(`Provider '${provider}' requires a specific model. Use --model option.`);
    }

    const apiKeyVar = getPrimaryApiKeyEnvVar(provider);
    const hadApiKeyBefore = Boolean(resolveApiKeyForProvider(provider));
    const defaultAgent = validated.defaultAgent;

    // Create and save preferences
    const preferences = createInitialPreferences(provider, model, apiKeyVar, defaultAgent);
    await saveGlobalPreferences(preferences);

    // Track provider/model selected during setup
    capture('dexto_setup', {
        provider,
        model,
        hadApiKeyBefore,
        setupMode: validated.interactive ? 'interactive' : 'non-interactive',
    });

    // Setup API key interactively (only if interactive mode enabled and key doesn't exist)
    if (validated.interactive) {
        const existingApiKey = resolveApiKeyForProvider(provider);
        if (existingApiKey) {
            p.outro(chalk.green(`✅ API key for ${provider} already configured`));
        } else {
            p.outro(chalk.cyan(`API key not found for ${provider}, starting api key setup...`));
            await interactiveApiKeySetup(provider);
        }
    }

    console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
}
