// packages/cli/src/cli/utils/provider-setup.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { type LLMProvider } from '@dexto/core';

/**
 * Standardized provider options used across all setup flows
 */
export const PROVIDER_OPTIONS = [
    {
        value: 'openai-compatible',
        label: '🚀 OpenRouter (Recommended)',
        hint: 'Access 100+ models with automatic setup - No API keys needed!',
    },
    {
        value: 'google',
        label: '🟢 Google Gemini',
        hint: 'Free tier available - Good for beginners',
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
];

/**
 * Interactive provider selection using standardized options
 * @returns Selected provider or null if cancelled
 */
export async function selectProvider(): Promise<LLMProvider> {
    const choice = await p.select({
        message: 'Choose your AI provider',
        options: PROVIDER_OPTIONS,
    });

    if (p.isCancel(choice)) {
        p.cancel('Setup cancelled');
        process.exit(1);
    }

    return choice as LLMProvider;
}

/**
 * Gets display name for a provider
 */
export function getProviderDisplayName(provider: LLMProvider): string {
    switch (provider) {
        case 'openai-compatible':
            return 'OpenRouter';
        case 'google':
            return 'Google Gemini';
        case 'openai':
            return 'OpenAI';
        case 'anthropic':
            return 'Anthropic';
        case 'groq':
            return 'Groq';
        default:
            return provider;
    }
}

/**
 * Validates API key format for a provider
 */
export function isValidApiKeyFormat(apiKey: string, provider: LLMProvider): boolean {
    switch (provider) {
        case 'openai-compatible':
            return apiKey.startsWith('sk-or-') && apiKey.length > 40;
        case 'google':
            return apiKey.startsWith('AIza') && apiKey.length > 20;
        case 'openai':
            return apiKey.startsWith('sk-') && apiKey.length > 40;
        case 'anthropic':
            return apiKey.startsWith('sk-ant-') && apiKey.length > 40;
        case 'groq':
            return apiKey.startsWith('gsk_') && apiKey.length > 40;
        default:
            return apiKey.length > 10; // Basic length check
    }
}

/**
 * Gets provider-specific instructions for API key setup
 */
export function getProviderInstructions(
    provider: LLMProvider
): { title: string; content: string } | null {
    switch (provider) {
        case 'openai-compatible':
            return {
                title: chalk.cyan('OpenRouter - Automatic Setup'),
                content:
                    `🚀 No manual API key setup needed!\n\n` +
                    `1. Click "Login with OpenRouter" below\n` +
                    `2. Sign in with Google/GitHub\n` +
                    `3. API key is automatically provisioned\n` +
                    `4. Access 100+ models instantly\n\n` +
                    `${chalk.dim('✨ Free tier included • No manual setup required')}`,
            };
        case 'google':
            return {
                title: chalk.green('Google Gemini - Free API Key'),
                content:
                    `1. Visit: ${chalk.cyan('https://aistudio.google.com/apikey')}\n` +
                    `2. Sign in with your Google account\n` +
                    `3. Click "Create API Key"\n` +
                    `4. Copy the key\n\n` +
                    `${chalk.dim('✨ Free tier included')}`,
            };
        case 'openai':
            return {
                title: chalk.blue('OpenAI API Key'),
                content:
                    `1. Visit: ${chalk.cyan('https://platform.openai.com/api-keys')}\n` +
                    `2. Sign in to your OpenAI account\n` +
                    `3. Click "Create new secret key"\n` +
                    `4. Copy the key\n\n` +
                    `${chalk.dim('💰 Requires payment')}`,
            };
        case 'anthropic':
            return {
                title: chalk.magenta('Anthropic API Key'),
                content:
                    `1. Visit: ${chalk.cyan('https://console.anthropic.com/settings/keys')}\n` +
                    `2. Sign in to your Anthropic account\n` +
                    `3. Click "Create Key"\n` +
                    `4. Copy the key\n\n` +
                    `${chalk.dim('💰 Requires payment')}`,
            };
        case 'groq':
            return {
                title: chalk.yellow('Groq API Key'),
                content:
                    `1. Visit: ${chalk.cyan('https://console.groq.com/keys')}\n` +
                    `2. Sign in with your account\n` +
                    `3. Click "Create API Key"\n` +
                    `4. Copy the key\n\n` +
                    `${chalk.dim('🆓 Free tier included')}`,
            };
        default:
            return null;
    }
}
