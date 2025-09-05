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
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';

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

    // Determine provider (interactive or from options)
    let provider = validated.provider;
    if (!provider) {
        provider = await selectProvider();
    }

    // Get model and API key details
    const model = validated.model || getDefaultModelForProvider(provider);
    if (!model) {
        throw new Error(`Provider '${provider}' requires a specific model. Use --model option.`);
    }

    const apiKeyVar = getPrimaryApiKeyEnvVar(provider);
    const defaultAgent = validated.defaultAgent;

    // Create and save preferences
    const preferences = createInitialPreferences(provider, model, apiKeyVar, defaultAgent);
    await saveGlobalPreferences(preferences);

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
