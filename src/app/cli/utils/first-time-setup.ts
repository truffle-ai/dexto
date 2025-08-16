import * as fs from 'fs/promises';
import * as path from 'path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { parseDocument } from 'yaml';
import {
    getBundledConfigPath,
    isUsingBundledConfig,
    getUserConfigPath,
    isDextoSourceCode,
} from '@core/utils/path.js';
import { LLMProvider, getDefaultModelForProvider } from '@core/index.js';
import pkg from '../../../../package.json' with { type: 'json' };
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { interactiveApiKeySetup } from './interactive-api-key-setup.js';
import { applyLayeredEnvironmentLoading } from '@core/utils/env.js';

/**
 * Detects if this is a first-time user scenario.
 * Checks if we're using the bundled config, but excludes the case
 * where we're in the dexto source code (development environment).
 */
export function isFirstTimeUserScenario(configPath: string): boolean {
    // If we're in dexto source code, never trigger first-time setup
    if (isDextoSourceCode()) {
        return false;
    }

    // Otherwise, use the existing bundled config check
    return isUsingBundledConfig(configPath);
}

/**
 * Shows provider selection UI for first-time users
 * @returns Selected provider or null if cancelled
 */
export async function showProviderPicker(): Promise<LLMProvider | null> {
    const choice = await p.select({
        message: 'Choose your AI provider',
        options: [
            {
                value: 'google',
                label: '🟢 Google Gemini',
                hint: 'Free tier available - Recommended for beginners',
            },
            {
                value: 'groq',
                label: '🟢 Groq',
                hint: 'Free tier available - Very fast responses',
            },
            {
                value: 'openai',
                label: '🟡 OpenAI',
                hint: 'Most popular, requires payment',
            },
            {
                value: 'anthropic',
                label: '🟡 Anthropic',
                hint: 'High quality models, requires payment',
            },
        ],
    });

    if (p.isCancel(choice)) {
        return null;
    }

    return choice as LLMProvider;
}

/**
 * Copies the bundled config to user's home directory with updated provider
 * @param provider The LLM provider to configure
 */
export async function copyBundledConfigWithProvider(provider: LLMProvider): Promise<void> {
    const bundledPath = getBundledConfigPath();
    const userConfigPath = getUserConfigPath();

    // Read bundled config
    const configContent = await fs.readFile(bundledPath, 'utf8');
    const doc = parseDocument(configContent);

    // Update LLM section with selected provider
    doc.setIn(['llm', 'provider'], provider);
    doc.setIn(['llm', 'model'], getDefaultModelForProvider(provider));
    doc.setIn(['llm', 'apiKey'], '$' + getPrimaryApiKeyEnvVar(provider));

    // Add a comment to track this was user-selected
    const llmNode = doc.getIn(['llm']);
    if (llmNode && typeof llmNode === 'object') {
        doc.commentBefore = ` Dexto configuration (v${pkg.version})\n This file was created from your provider selection.\n To reset, delete this file and run dexto again.`;
    }

    // Ensure ~/.dexto directory exists
    const dir = path.dirname(getUserConfigPath());
    await fs.mkdir(dir, { recursive: true });

    // Write the complete config
    await fs.writeFile(userConfigPath, doc.toString(), 'utf8');
}

/**
 * Handles the complete first-time user setup flow:
 * 1. Welcome message
 * 2. Provider selection
 * 3. Config creation
 * 4. API key setup
 * 5. Environment reload
 *
 * @returns true if setup completed successfully, false if cancelled
 */
export async function handleFirstTimeSetup(): Promise<boolean> {
    console.log(chalk.cyan("\n🎉 Welcome to Dexto! Let's get you started.\n"));

    // Step 1: Pick provider
    const provider = await showProviderPicker();
    if (!provider) {
        // User cancelled
        return false;
    }

    console.log(chalk.dim('\n📝 Creating your configuration...\n'));

    // Step 2: Copy config with selected provider
    try {
        await copyBundledConfigWithProvider(provider);
        console.log(chalk.green(`✓ Created your config at: ${getUserConfigPath()}`));
    } catch (error) {
        console.error(chalk.red(`❌ Failed to create config: ${error}`));
        return false;
    }

    // Step 3: Set up API key for the chosen provider
    console.log(chalk.dim("\n🔑 Now let's set up your API key...\n"));
    const keySetup = await interactiveApiKeySetup(provider);

    if (!keySetup) {
        // Config created but no key set up
        console.log(chalk.yellow('\n⚠️  Config created but API key not set.'));
        console.log(chalk.dim('Add your API key to .env and run dexto again.'));
        return false;
    }

    // Step 4: Reload environment so the new key takes effect
    await applyLayeredEnvironmentLoading();

    console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
    return true;
}
