// src/app/cli/global-commands/setup.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { type LLMProvider, getDefaultModelForProvider } from '@core/llm/registry.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { createInitialPreferences, saveGlobalPreferences } from '@core/preferences/loader.js';
import { interactiveApiKeySetup } from '@app/cli/utils/api-key-setup.js';
import { PROVIDER_OPTIONS, selectProvider } from '@app/cli/utils/provider-setup.js';

export interface CLISetupOptions {
    llmProvider?: LLMProvider;
    model?: string;
    defaultAgent?: string;
    noInteractive?: boolean;
}

export async function handleSetupCommand(options: CLISetupOptions): Promise<void> {
    console.log(chalk.cyan('\n🎉 Setting up Dexto preferences...\n'));

    // Determine provider (interactive or from options)
    let provider = options.llmProvider;
    if (!provider) {
        if (options.noInteractive) {
            throw new Error(
                'Provider required in non-interactive mode. Use --llm-provider option.'
            );
        }

        provider = await selectProvider();
        if (!provider) {
            console.log('Setup cancelled');
            return;
        }
    }

    // Get model and API key details
    const model = options.model || getDefaultModelForProvider(provider);
    const apiKeyVar = getPrimaryApiKeyEnvVar(provider);
    const defaultAgent = options.defaultAgent || 'default-agent';

    // Create and save preferences
    const preferences = createInitialPreferences(provider, model, apiKeyVar, defaultAgent);
    await saveGlobalPreferences(preferences);

    // Setup API key interactively
    if (!options.noInteractive) {
        await interactiveApiKeySetup(provider);
    }

    console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
}
