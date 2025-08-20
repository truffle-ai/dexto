// src/app/cli/commands/setup.ts

import chalk from 'chalk';
import { z } from 'zod';
import { getDefaultModelForProvider, LLM_PROVIDERS } from '@core/llm/registry.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { createInitialPreferences, saveGlobalPreferences } from '@core/preferences/loader.js';
import { interactiveApiKeySetup } from '@app/cli/utils/api-key-setup.js';
import { selectProvider } from '@app/cli/utils/provider-setup.js';

// Zod schema for setup command validation
const SetupCommandSchema = z
    .object({
        llmProvider: z.enum(LLM_PROVIDERS).optional(),
        model: z.string().min(1, 'Model name cannot be empty').optional(),
        defaultAgent: z
            .string()
            .min(1, 'Default agent name cannot be empty')
            .default('default-agent'),
        interactive: z.boolean().default(true),
    })
    .strict();

export type CLISetupOptions = z.output<typeof SetupCommandSchema>;

/**
 * Validate setup command options with comprehensive validation
 */
function validateSetupCommand(options: Partial<CLISetupOptions>): CLISetupOptions {
    // Basic structure validation
    const validated = SetupCommandSchema.parse(options);

    // Business logic validation
    if (!validated.interactive && !validated.llmProvider) {
        throw new Error('Provider required in non-interactive mode. Use --llm-provider option.');
    }

    return validated;
}

export async function handleSetupCommand(options: Partial<CLISetupOptions>): Promise<void> {
    // Validate command with Zod
    const validated = validateSetupCommand(options);

    console.log(chalk.cyan('\n🎉 Setting up Dexto...\n'));

    // Determine provider (interactive or from options)
    let provider = validated.llmProvider;
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
    //console.log('Creating initial preferences...');
    const preferences = createInitialPreferences(provider, model, apiKeyVar, defaultAgent);
    await saveGlobalPreferences(preferences);
    //console.log('Preferences saved');

    // Setup API key interactively (only if interactive mode enabled)
    if (validated.interactive) {
        await interactiveApiKeySetup(provider);
    }
}
