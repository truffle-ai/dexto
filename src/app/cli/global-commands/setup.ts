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
    interactive?: boolean;
}

export async function handleSetupCommand(options: CLISetupOptions): Promise<void> {
    console.log(chalk.cyan('\n🎉 Setting up Dexto preferences...\n'));
    console.log('options', options);

    // Determine provider (interactive or from options)
    let provider = options.llmProvider;
    if (!provider) {
        if (!options.interactive) {
            throw new Error(
                'Provider required in non-interactive mode. Use --llm-provider option.'
            );
        }

        const selectedProvider = await selectProvider();
        if (!selectedProvider) {
            console.log('Setup cancelled');
            return;
        }
        provider = selectedProvider;
    }

    // Get model and API key details
    const model = options.model || getDefaultModelForProvider(provider);
    if (!model) {
        throw new Error(`Provider '${provider}' requires a specific model. Use --model option.`);
    }

    const apiKeyVar = getPrimaryApiKeyEnvVar(provider);
    const defaultAgent = options.defaultAgent || 'default-agent';

    // Create and save preferences
    console.log('Creating initial preferences...');
    const preferences = createInitialPreferences(provider, model, apiKeyVar, defaultAgent);
    await saveGlobalPreferences(preferences);
    console.log('Preferences saved');

    // Setup API key interactively (only if interactive mode enabled)
    if (options.interactive) {
        await interactiveApiKeySetup(provider);
    } else {
        console.log('Skipping API key setup (non-interactive mode)');
        console.log(`Set your API key: export ${apiKeyVar}=your_api_key_here`);
    }

    console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
}
