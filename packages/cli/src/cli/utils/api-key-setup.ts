// packages/cli/src/cli/utils/api-key-setup.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { LLMProvider } from '@dexto/core';
import { logger, getExecutionContext } from '@dexto/core';
import { saveProviderApiKey } from '@dexto/agent-management';
import { applyLayeredEnvironmentLoading } from '../../utils/env.js';
import {
    getProviderDisplayName,
    validateApiKeyFormat,
    getProviderInstructions,
    openApiKeyUrl,
    getProviderInfo,
    getProviderEnvVar,
} from './provider-setup.js';
import { verifyApiKey } from './api-key-verification.js';

export interface ApiKeySetupResult {
    success: boolean;
    apiKey?: string;
    cancelled?: boolean;
    skipped?: boolean;
    error?: string;
}

/**
 * Interactively prompts the user to set up an API key for a specific provider.
 * Includes browser auto-open, format validation with hints, and API key verification.
 *
 * @param provider - The specific provider that needs API key setup
 * @param options - Configuration options
 * @returns Result indicating success, cancellation, or error
 */
export async function interactiveApiKeySetup(
    provider: LLMProvider,
    options: {
        exitOnCancel?: boolean;
        skipVerification?: boolean;
        model?: string;
    } = {}
): Promise<ApiKeySetupResult> {
    const { exitOnCancel = true, skipVerification = false, model } = options;

    try {
        p.intro(chalk.cyan('🔑 API Key Setup'));

        const instructions = getProviderInstructions(provider);
        const providerInfo = getProviderInfo(provider);

        // Show targeted message for the required provider
        if (instructions) {
            p.note(
                `Your configuration requires a ${getProviderDisplayName(provider)} API key.\n\n` +
                    instructions.content,
                chalk.bold(instructions.title)
            );
        }

        // Ask what they want to do - with "Open in browser" option
        const hasApiKeyUrl = Boolean(providerInfo?.apiKeyUrl);
        const actionOptions = [
            ...(hasApiKeyUrl
                ? [
                      {
                          value: 'open-browser' as const,
                          label: `${chalk.green('→')} Get API key (opens browser)`,
                          hint: "We'll wait while you grab one",
                      },
                  ]
                : []),
            {
                value: 'setup' as const,
                label: `${chalk.cyan('●')} Paste existing key`,
                hint: 'I already have an API key',
            },
            {
                value: 'skip' as const,
                label: `${chalk.gray('○')} Set up later`,
                hint: 'Continue without key for now',
            },
        ];

        const action = await p.select({
            message: 'What would you like to do?',
            options: actionOptions,
        });

        if (p.isCancel(action)) {
            p.cancel('Setup cancelled');
            if (exitOnCancel) process.exit(0);
            return { success: false, cancelled: true };
        }

        if (action === 'skip') {
            const envVar = getProviderEnvVar(provider);
            p.note(
                `You can configure your API key later:\n\n` +
                    `${chalk.cyan('Option 1:')} Run ${chalk.bold('dexto setup')}\n\n` +
                    `${chalk.cyan('Option 2:')} Set environment variable manually:\n` +
                    `  ${chalk.dim(`export ${envVar}=your-key-here`)}\n` +
                    `  ${chalk.dim('Add to ~/.bashrc or ~/.zshrc to persist')}`,
                'Setup Later'
            );
            return { success: true, skipped: true };
        }

        // Open browser if requested
        if (action === 'open-browser') {
            const spinner = p.spinner();
            spinner.start('Opening browser...');
            const opened = await openApiKeyUrl(provider);
            if (opened) {
                spinner.stop('Browser opened! Get your API key and paste it below.');
            } else {
                spinner.stop(`Could not open browser. Visit: ${providerInfo?.apiKeyUrl}`);
            }
        }

        // Prompt for API key with improved validation
        const apiKey = await promptForApiKey(provider);
        if (!apiKey) {
            if (exitOnCancel) process.exit(0);
            return { success: false, cancelled: true };
        }

        // Verify API key works (unless skipped)
        if (!skipVerification) {
            const verificationResult = await verifyApiKeyWithSpinner(provider, apiKey, model);
            if (!verificationResult.success) {
                p.log.error(verificationResult.error || 'API key verification failed');

                const retryAction = await p.select({
                    message: 'What would you like to do?',
                    options: [
                        {
                            value: 'retry' as const,
                            label: 'Try a different API key',
                            hint: 'Enter a new API key',
                        },
                        {
                            value: 'save-anyway' as const,
                            label: 'Save anyway',
                            hint: 'Key might still work - save and continue',
                        },
                        {
                            value: 'skip' as const,
                            label: 'Skip for now',
                            hint: 'Continue without saving - configure later',
                        },
                    ],
                });

                if (p.isCancel(retryAction)) {
                    if (exitOnCancel) process.exit(1);
                    const result: ApiKeySetupResult = { success: false, cancelled: true };
                    return result;
                }

                if (retryAction === 'retry') {
                    // Recursive retry
                    return interactiveApiKeySetup(provider, options);
                }

                if (retryAction === 'skip') {
                    p.log.warn(
                        'Skipping API key setup. You can configure it later with: dexto setup'
                    );
                    return { success: true, skipped: true };
                }

                // retryAction === 'save-anyway' - fall through to save
                p.log.info('Saving API key despite verification failure...');
            }
        }

        // Save API key
        const saveResult = await saveApiKeyWithSpinner(provider, apiKey);
        if (!saveResult.success) {
            showManualSaveInstructions(provider, apiKey);
            p.log.warn('You can configure API key later with: dexto setup');
            // Don't fail - return success with the API key for in-memory use
            return { success: true, apiKey, skipped: true };
        }

        p.outro(chalk.green('✨ API key setup complete!'));
        return { success: true, apiKey };
    } catch (error) {
        if (p.isCancel(error)) {
            p.cancel('Setup cancelled');
            if (exitOnCancel) process.exit(0);
            return { success: false, cancelled: true };
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`API key setup failed: ${errorMessage}`);

        if (exitOnCancel) {
            console.error(chalk.red('\n❌ API key setup required to continue.'));
            process.exit(1);
        }

        return { success: false, error: errorMessage };
    }
}

/**
 * Prompt for API key with format validation and hints
 */
async function promptForApiKey(provider: LLMProvider): Promise<string | null> {
    const providerInfo = getProviderInfo(provider);
    const formatHint = providerInfo?.apiKeyPrefix
        ? chalk.gray(` (starts with ${providerInfo.apiKeyPrefix})`)
        : '';

    const apiKey = await p.password({
        message: `Enter your ${getProviderDisplayName(provider)} API key${formatHint}`,
        mask: '*',
        validate: (value) => {
            const result = validateApiKeyFormat(value, provider);
            if (!result.valid) {
                return result.error;
            }
            return undefined;
        },
    });

    if (p.isCancel(apiKey)) {
        p.cancel('Setup cancelled');
        return null;
    }

    return apiKey.trim();
}

/**
 * Verify API key with a spinner
 */
async function verifyApiKeyWithSpinner(
    provider: LLMProvider,
    apiKey: string,
    model?: string
): Promise<{ success: boolean; error?: string }> {
    const spinner = p.spinner();
    spinner.start('Verifying API key...');

    try {
        const result = await verifyApiKey(provider, apiKey, model);

        if (result.success) {
            spinner.stop(chalk.green('✓ API key verified successfully!'));
            return { success: true };
        } else {
            spinner.stop(chalk.red('✗ API key verification failed'));
            const response: { success: boolean; error?: string } = { success: false };
            if (result.error) response.error = result.error;
            return response;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        spinner.stop(chalk.red('✗ Verification failed'));
        return { success: false, error: errorMessage };
    }
}

/**
 * Save API key with a spinner
 */
async function saveApiKeyWithSpinner(
    provider: LLMProvider,
    apiKey: string
): Promise<{ success: boolean; error?: string; path?: string }> {
    const spinner = p.spinner();
    spinner.start('Saving API key...');

    try {
        const meta = await saveProviderApiKey(provider, apiKey, process.cwd());
        spinner.stop(chalk.green(`✓ API key saved to ${meta.targetEnvPath}`));

        // Reload environment variables
        await applyLayeredEnvironmentLoading();

        return { success: true, path: meta.targetEnvPath };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        spinner.stop(chalk.red('✗ Failed to save API key'));
        logger.error(`Failed to save API key: ${errorMessage}`);
        return { success: false, error: errorMessage };
    }
}

/**
 * Show manual setup instructions when automatic save fails
 */
function showManualSaveInstructions(provider: LLMProvider, apiKey: string): void {
    const envVar = getProviderEnvVar(provider);
    const maskedKey = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);

    const instructions =
        getExecutionContext() === 'global-cli'
            ? [
                  `1. Create or edit: ${chalk.cyan('~/.dexto/.env')}`,
                  `2. Add this line: ${chalk.rgb(255, 165, 0)(`${envVar}=${maskedKey}`)}`,
                  `3. Run ${chalk.cyan('dexto')} again`,
              ]
            : [
                  `1. Create or edit: ${chalk.cyan('.env')} in your project`,
                  `2. Add this line: ${chalk.rgb(255, 165, 0)(`${envVar}=your_api_key`)}`,
                  `3. Run ${chalk.cyan('dexto')} again`,
              ];

    p.note(instructions.join('\n'), chalk.rgb(255, 165, 0)('Manual Setup Required'));
}

/**
 * Quick check if an API key is already configured for a provider
 */
export function hasApiKeyConfigured(provider: LLMProvider): boolean {
    const envVar = getProviderEnvVar(provider);
    return Boolean(process.env[envVar]);
}

/**
 * Result when user is prompted about pending API key setup
 */
export interface PendingSetupPromptResult {
    action: 'setup' | 'skip' | 'cancel';
    apiKey?: string;
}

/**
 * Prompts user about pending API key setup from a previous incomplete setup.
 * This is shown when user previously skipped API key setup and is now trying to run dexto.
 *
 * @param provider - The provider that needs API key setup
 * @param model - The model configured for the provider
 * @returns Result indicating which action the user chose
 */
export async function promptForPendingApiKey(
    provider: LLMProvider,
    model: string
): Promise<PendingSetupPromptResult> {
    const providerName = getProviderDisplayName(provider);

    p.intro(chalk.cyan('🔧 Complete Your Setup'));

    p.note(
        `You previously set up Dexto with ${chalk.bold(providerName)} but skipped API key configuration.\n\n` +
            `To use ${providerName}/${model}, you'll need to add your API key.`,
        'Setup Incomplete'
    );

    const action = await p.select({
        message: 'What would you like to do?',
        options: [
            {
                value: 'setup' as const,
                label: `Set up ${providerName} API key now`,
                hint: 'Recommended - complete your setup',
            },
            {
                value: 'skip' as const,
                label: 'Skip for now',
                hint: 'Continue without API key - will show error when trying to use LLM',
            },
            {
                value: 'cancel' as const,
                label: 'Exit',
                hint: 'Exit and set up later with: dexto setup',
            },
        ],
    });

    if (p.isCancel(action)) {
        p.cancel('Cancelled');
        return { action: 'cancel' };
    }

    if (action === 'cancel') {
        return { action: 'cancel' };
    }

    if (action === 'skip') {
        p.log.warn('Continuing without API key. You may see errors when the LLM is invoked.');
        return { action: 'skip' };
    }

    // action === 'setup' - use the existing API key setup flow
    const setupResult = await interactiveApiKeySetup(provider, {
        exitOnCancel: false,
        model,
    });

    if (setupResult.cancelled) {
        return { action: 'cancel' };
    }

    if (setupResult.skipped) {
        p.log.warn('API key setup skipped. You can configure it later with: dexto setup');
        return { action: 'skip' };
    }

    if (setupResult.success && setupResult.apiKey) {
        return { action: 'setup', apiKey: setupResult.apiKey };
    }

    return { action: 'skip' };
}

/**
 * Result when user is prompted about missing API key for a specific agent
 */
export interface AgentApiKeyPromptResult {
    action: 'add-key' | 'use-default' | 'cancel';
    apiKey?: string; // Only set if action is 'add-key' and key was successfully added
}

/**
 * Prompts user when loading a specific agent that requires an API key they don't have.
 * Offers options to add the API key, continue with their default LLM, or cancel.
 *
 * @param agentProvider - The provider the agent requires
 * @param agentModel - The model the agent uses
 * @param userProvider - The user's default provider (from preferences)
 * @param userModel - The user's default model (from preferences)
 * @returns Result indicating which action the user chose
 */
export async function promptForMissingAgentApiKey(
    agentProvider: LLMProvider,
    agentModel: string,
    userProvider: LLMProvider,
    userModel: string
): Promise<AgentApiKeyPromptResult> {
    const agentProviderName = getProviderDisplayName(agentProvider);
    const userProviderName = getProviderDisplayName(userProvider);
    const userDefault = `${userProviderName}/${userModel}`;

    p.intro(chalk.cyan('🔧 Agent Configuration'));

    p.note(
        `This agent is configured for ${chalk.bold(`${agentProviderName}/${agentModel}`)}\n` +
            `but you don't have an API key set up for ${agentProviderName}.\n\n` +
            `Your default LLM is ${chalk.green(userDefault)}.`,
        'Missing API Key'
    );

    const action = await p.select({
        message: 'What would you like to do?',
        options: [
            {
                value: 'use-default' as const,
                label: `Continue with ${userDefault}`,
                hint: 'Agent will use your default LLM instead (behavior may differ)',
            },
            {
                value: 'add-key' as const,
                label: `Set up ${agentProviderName} API key`,
                hint: `Configure ${agentProviderName} to run agent as intended`,
            },
            {
                value: 'cancel' as const,
                label: 'Cancel',
                hint: 'Exit without running the agent',
            },
        ],
    });

    if (p.isCancel(action)) {
        p.cancel('Cancelled');
        return { action: 'cancel' };
    }

    if (action === 'cancel') {
        return { action: 'cancel' };
    }

    if (action === 'use-default') {
        p.log.warn(
            `Using ${userDefault} instead of ${agentProviderName}/${agentModel}. ` +
                `Agent behavior may differ from intended.`
        );
        return { action: 'use-default' };
    }

    // action === 'add-key' - use the existing API key setup flow
    const setupResult = await interactiveApiKeySetup(agentProvider, {
        exitOnCancel: false,
        model: agentModel,
    });

    if (setupResult.cancelled) {
        return { action: 'cancel' };
    }

    if (setupResult.skipped) {
        // User skipped in the API key setup - ask again what they want to do
        const skipAction = await p.select({
            message: 'API key setup was skipped. What would you like to do?',
            options: [
                {
                    value: 'use-default' as const,
                    label: `Continue with ${userDefault}`,
                    hint: 'Agent will use your default LLM instead',
                },
                {
                    value: 'cancel' as const,
                    label: 'Cancel',
                    hint: 'Exit without running the agent',
                },
            ],
        });

        if (p.isCancel(skipAction) || skipAction === 'cancel') {
            return { action: 'cancel' };
        }

        p.log.warn(
            `Using ${userDefault} instead of ${agentProviderName}/${agentModel}. ` +
                `Agent behavior may differ from intended.`
        );
        return { action: 'use-default' };
    }

    if (setupResult.success && setupResult.apiKey) {
        return { action: 'add-key', apiKey: setupResult.apiKey };
    }

    // Shouldn't reach here, but default to cancel
    return { action: 'cancel' };
}
