import { z } from 'zod';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    AgentConfigSchema,
    createAgentConfigSchema,
    type AgentConfig,
    type ValidatedAgentConfig,
} from '@dexto/agent-config';
import type { LLMValidationOptions } from '@dexto/core';
import { interactiveApiKeySetup } from './api-key-setup.js';
import { LLMErrorCode } from '@dexto/core';
import type { LLMProvider } from '@dexto/core';
import { logger } from '@dexto/core';
import {
    getGlobalPreferencesPath,
    loadGlobalPreferences,
    saveGlobalPreferences,
} from '@dexto/agent-management';
import { handleSyncAgentsCommand } from '../commands/sync-agents.js';

export interface ValidationResult {
    success: boolean;
    config?: ValidatedAgentConfig;
    errors?: string[];
    skipped?: boolean;
}

/**
 * Validates agent config with optional interactive fixes for user experience.
 * Uses schema parsing to detect API key issues and provides targeted setup.
 * Returns validated config with all defaults applied.
 *
 * IMPORTANT: This function NEVER exits the process. It always returns a result
 * that allows the caller to decide what to do next.
 *
 * @param config - The agent configuration to validate
 * @param interactive - Whether to allow interactive prompts to fix issues
 * @param validationOptions - Validation strictness options
 * @param validationOptions.strict - When true (default), enforces API key requirements.
 *                                   When false, allows missing credentials for interactive config.
 */
export async function validateAgentConfig(
    config: AgentConfig,
    interactive: boolean = false,
    validationOptions?: LLMValidationOptions & { agentPath?: string }
): Promise<ValidationResult> {
    // Use appropriate schema based on validation options
    // Default to strict validation unless explicitly relaxed
    const schema =
        validationOptions?.strict === false
            ? createAgentConfigSchema({ strict: false })
            : AgentConfigSchema;

    // Parse with schema to detect issues
    const parseResult = schema.safeParse(config);

    if (parseResult.success) {
        return { success: true, config: parseResult.data };
    }

    // Validation failed - handle based on mode
    logger.debug(`Agent config validation error: ${JSON.stringify(parseResult.error)}`);
    const errors = formatZodErrors(parseResult.error);

    if (!interactive) {
        // Non-interactive mode: show errors and next steps, but don't exit
        showValidationErrors(errors);
        showNextSteps();
        return { success: false, errors };
    }

    // Interactive mode: try to help the user fix the issue
    // Check for API key errors first
    const apiKeyError = findApiKeyError(parseResult.error, config);
    if (apiKeyError) {
        return await handleApiKeyError(apiKeyError.provider, config, errors, validationOptions);
    }

    // Check for baseURL errors next
    const baseURLError = findBaseURLError(parseResult.error, config);
    if (baseURLError) {
        return await handleBaseURLError(baseURLError.provider, config, errors, validationOptions);
    }

    // Other validation errors - show options
    return await handleOtherErrors(errors, validationOptions);
}

/**
 * Handle API key validation errors interactively
 */
async function handleApiKeyError(
    provider: LLMProvider,
    config: AgentConfig,
    errors: string[],
    validationOptions?: LLMValidationOptions
): Promise<ValidationResult> {
    console.log(chalk.rgb(255, 165, 0)(`\n🔑 API key issue detected for ${provider} provider\n`));

    const action = await p.select({
        message: 'How would you like to proceed?',
        options: [
            {
                value: 'setup' as const,
                label: 'Set up API key now',
                hint: 'Configure the API key interactively',
            },
            {
                value: 'skip' as const,
                label: 'Continue anyway',
                hint: 'Try to start without fixing (may fail)',
            },
            {
                value: 'edit' as const,
                label: 'Edit configuration manually',
                hint: 'Show file path and instructions',
            },
        ],
    });

    if (p.isCancel(action)) {
        showNextSteps();
        return { success: false, errors, skipped: true };
    }

    if (action === 'setup') {
        const result = await interactiveApiKeySetup(provider, { exitOnCancel: false });
        if (result.success && !result.skipped) {
            // Retry validation after API key setup
            return validateAgentConfig(config, true, validationOptions);
        }
        // Setup was skipped or cancelled - let them continue anyway
        return { success: false, errors, skipped: true };
    }

    if (action === 'edit') {
        showManualEditInstructions(undefined);
        return { success: false, errors, skipped: true };
    }

    // 'skip' - continue anyway
    p.log.warn('Continuing with validation errors - some features may not work correctly');
    return { success: false, errors, skipped: true };
}

/**
 * Handle baseURL validation errors interactively
 */
async function handleBaseURLError(
    provider: LLMProvider,
    config: AgentConfig,
    errors: string[],
    validationOptions?: LLMValidationOptions
): Promise<ValidationResult> {
    console.log(chalk.rgb(255, 165, 0)(`\n🌐 Base URL required for ${provider} provider\n`));

    const providerExamples: Record<string, string> = {
        'openai-compatible': 'http://localhost:11434/v1 (Ollama)',
        litellm: 'http://localhost:4000 (LiteLLM proxy)',
    };

    const example = providerExamples[provider] || 'http://localhost:8080/v1';

    p.note(
        [
            `The ${provider} provider requires a base URL to connect to your`,
            `local or custom LLM endpoint.`,
            ``,
            `${chalk.gray('Example:')} ${example}`,
        ].join('\n'),
        'Base URL Required'
    );

    const action = await p.select({
        message: 'How would you like to proceed?',
        options: [
            {
                value: 'setup' as const,
                label: 'Enter base URL now',
                hint: 'Configure the base URL interactively',
            },
            {
                value: 'skip' as const,
                label: 'Continue anyway',
                hint: 'Try to start without fixing (may fail)',
            },
            {
                value: 'edit' as const,
                label: 'Edit configuration manually',
                hint: 'Show file path and instructions',
            },
        ],
    });

    if (p.isCancel(action)) {
        showNextSteps();
        return { success: false, errors, skipped: true };
    }

    if (action === 'setup') {
        const result = await interactiveBaseURLSetup(provider, config.llm?.baseURL);
        if (result.success && !result.skipped && result.baseURL && config.llm) {
            // Update config with the new baseURL for retry validation
            const updatedConfig = {
                ...config,
                llm: { ...config.llm, baseURL: result.baseURL },
            };
            // Retry validation after baseURL setup
            return validateAgentConfig(updatedConfig, true, validationOptions);
        }
        // Setup was skipped or cancelled
        return { success: false, errors, skipped: true };
    }

    if (action === 'edit') {
        showManualEditInstructions(undefined);
        return { success: false, errors, skipped: true };
    }

    // 'skip' - continue anyway
    p.log.warn('Continuing with validation errors - some features may not work correctly');
    return { success: false, errors, skipped: true };
}

/**
 * Interactive baseURL setup
 */
async function interactiveBaseURLSetup(
    provider: LLMProvider,
    existingBaseURL?: string
): Promise<{ success: boolean; baseURL?: string; skipped?: boolean }> {
    const providerDefaults: Record<string, string> = {
        'openai-compatible': 'http://localhost:11434/v1',
        litellm: 'http://localhost:4000',
    };

    // Use existing baseURL if available, otherwise fall back to provider defaults
    const defaultURL = existingBaseURL || providerDefaults[provider] || '';

    const baseURL = await p.text({
        message: `Enter base URL for ${provider}`,
        placeholder: defaultURL,
        initialValue: defaultURL,
        validate: (value) => {
            if (!value.trim()) {
                return 'Base URL is required';
            }
            try {
                new URL(value.trim());
                return undefined;
            } catch {
                return 'Please enter a valid URL (e.g., http://localhost:11434/v1)';
            }
        },
    });

    if (p.isCancel(baseURL)) {
        p.log.warn('Skipping base URL setup. You can configure it later with: dexto setup');
        return { success: false, skipped: true };
    }

    const trimmedURL = baseURL.trim();

    // Save to preferences
    const spinner = p.spinner();
    spinner.start('Saving base URL to preferences...');

    try {
        const preferences = await loadGlobalPreferences();

        // Update the LLM section with baseURL (complete replacement as per schema design)
        const updatedPreferences = {
            ...preferences,
            llm: {
                ...preferences.llm,
                baseURL: trimmedURL,
            },
        };

        await saveGlobalPreferences(updatedPreferences);
        spinner.stop(chalk.green('✓ Base URL saved to preferences'));

        return { success: true, baseURL: trimmedURL };
    } catch (error) {
        spinner.stop(chalk.red('✗ Failed to save base URL'));
        logger.error(
            `Failed to save baseURL: ${error instanceof Error ? error.message : String(error)}`
        );

        // Show manual instructions
        p.note(
            [
                `Add this to your preferences file:`,
                ``,
                `  ${chalk.cyan('baseURL:')} ${trimmedURL}`,
                ``,
                `File: ${getGlobalPreferencesPath()}`,
            ].join('\n'),
            chalk.rgb(255, 165, 0)('Manual Setup Required')
        );

        // Still return success with the URL for in-memory use
        return { success: true, baseURL: trimmedURL, skipped: true };
    }
}

/**
 * Handle non-API-key validation errors interactively
 */
async function handleOtherErrors(
    errors: string[],
    validationOptions?: LLMValidationOptions & { agentPath?: string }
): Promise<ValidationResult> {
    console.log(chalk.rgb(255, 165, 0)('\n⚠️  Configuration issues detected:\n'));
    for (const error of errors) {
        console.log(chalk.red(`  • ${error}`));
    }
    console.log('');

    const action = await p.select({
        message: 'How would you like to proceed?',
        options: [
            {
                value: 'sync' as const,
                label: 'Sync agent config',
                hint: 'Update from bundled registry (recommended)',
            },
            {
                value: 'skip' as const,
                label: 'Continue anyway',
                hint: 'Try to start despite errors (may fail)',
            },
            {
                value: 'edit' as const,
                label: 'Edit configuration manually',
                hint: 'Show file path and instructions',
            },
        ],
    });

    if (p.isCancel(action)) {
        showNextSteps();
        return { success: false, errors, skipped: true };
    }

    if (action === 'sync') {
        try {
            // Run sync-agents to update the agent config
            await handleSyncAgentsCommand({ force: true, quiet: false });
            // Exit after sync - user needs to restart dexto
            p.outro(chalk.gray('Run dexto to start Dexto'));
            process.exit(0);
        } catch (error) {
            p.log.error(
                `Failed to sync agent: ${error instanceof Error ? error.message : String(error)}`
            );
            return { success: false, errors, skipped: true };
        }
    }

    if (action === 'edit') {
        showManualEditInstructions(validationOptions?.agentPath);
        return { success: false, errors, skipped: true };
    }

    // 'skip' - continue anyway
    p.log.warn('Continuing with validation errors - some features may not work correctly');
    return { success: false, errors, skipped: true };
}

/**
 * Show validation errors in a user-friendly way
 */
function showValidationErrors(errors: string[]): void {
    console.log(chalk.rgb(255, 165, 0)('\n⚠️  Configuration issues detected:\n'));
    for (const error of errors) {
        console.log(chalk.red(`  • ${error}`));
    }
    console.log('');
}

/**
 * Show next steps after validation failure
 */
function showNextSteps(): void {
    const prefsPath = getGlobalPreferencesPath();
    console.log(chalk.bold('\nNext steps:'));
    console.log(`  • Run ${chalk.cyan('dexto setup')} to reconfigure interactively`);
    console.log(`  • Edit ${chalk.cyan(prefsPath)} directly`);
    console.log(`  • Check your environment variables\n`);
}

/**
 * Show manual edit instructions
 */
function showManualEditInstructions(agentPath?: string): void {
    const prefsPath = getGlobalPreferencesPath();
    const configPaths = [`  ${chalk.cyan('Global preferences:')} ${prefsPath}`];

    if (agentPath) {
        configPaths.push(`  ${chalk.cyan('Agent config:')} ${agentPath}`);
    } else {
        configPaths.push(`  ${chalk.cyan('Agent configs:')} ~/.dexto/agents/*/`);
    }

    p.note(
        [
            `Your configuration files:`,
            ``,
            ...configPaths,
            ``,
            `Edit the appropriate file and run dexto again.`,
            ``,
            chalk.gray('Example commands:'),
            ...(agentPath
                ? [
                      chalk.gray(`  code ${agentPath}     # Open in VS Code`),
                      chalk.gray(`  nano ${agentPath}     # Edit in terminal`),
                  ]
                : [
                      chalk.gray(`  code ${prefsPath}     # Open in VS Code`),
                      chalk.gray(`  nano ${prefsPath}     # Edit in terminal`),
                  ]),
        ].join('\n'),
        'Manual Configuration'
    );
}

/**
 * Extract API key error details from Zod validation error
 */
function findApiKeyError(
    error: z.ZodError,
    configData: AgentConfig
): { provider: LLMProvider } | null {
    for (const issue of error.issues) {
        // Check for our custom LLM_MISSING_API_KEY error code in params
        if (issue.code === 'custom' && hasErrorCode(issue.params, LLMErrorCode.API_KEY_MISSING)) {
            // Extract provider from error params (added by our schema)
            const provider = getProviderFromParams(issue.params);
            if (provider) {
                return { provider };
            }
        }

        // Fallback: check for apiKey path errors and extract provider from config
        if (issue.path.includes('apiKey') && issue.message.includes('Missing API key')) {
            const provider = configData.llm?.provider;
            if (provider) {
                return { provider };
            }
        }
    }
    return null;
}

/**
 * Extract baseURL error details from Zod validation error
 */
function findBaseURLError(
    error: z.ZodError,
    configData: AgentConfig
): { provider: LLMProvider } | null {
    for (const issue of error.issues) {
        // Check for our custom BASE_URL_MISSING error code in params
        if (issue.code === 'custom' && hasErrorCode(issue.params, LLMErrorCode.BASE_URL_MISSING)) {
            const provider = getProviderFromParams(issue.params) || configData.llm?.provider;
            if (provider) {
                return { provider };
            }
        }

        // Fallback: check for baseURL path errors
        if (issue.path.includes('baseURL') && issue.message.includes('requires')) {
            const provider = configData.llm?.provider;
            if (provider) {
                return { provider };
            }
        }
    }
    return null;
}

/**
 * Type guard to check if params contains the expected error code
 */
function hasErrorCode(params: unknown, expectedCode: LLMErrorCode): boolean {
    return (
        typeof params === 'object' &&
        params !== null &&
        'code' in params &&
        params.code === expectedCode
    );
}

/**
 * Extract provider from Zod issue params
 */
function getProviderFromParams(params: unknown): LLMProvider | null {
    if (
        typeof params === 'object' &&
        params !== null &&
        'provider' in params &&
        typeof params.provider === 'string'
    ) {
        return params.provider as LLMProvider;
    }
    return null;
}

/**
 * Format Zod validation errors in a user-friendly way
 */
function formatZodErrors(error: z.ZodError): string[] {
    return error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
        return `${path}: ${issue.message}`;
    });
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use validateAgentConfig with result handling instead
 */
export async function validateAgentConfigOrExit(
    config: AgentConfig,
    interactive: boolean = false
): Promise<ValidatedAgentConfig> {
    const result = await validateAgentConfig(config, interactive);

    if (result.success && result.config) {
        return result.config;
    }

    // If validation failed but was skipped, return config as-is with defaults applied
    // This allows the app to launch in a limited capacity (e.g., web UI for configuration)
    // Runtime errors will occur when actually trying to use the LLM
    if (result.skipped) {
        logger.warn('Starting with validation warnings - some features may not work');

        // Apply defaults manually without strict validation
        // This allows launching web UI for interactive configuration
        // Use unknown cast to bypass branded type checking since we're intentionally
        // returning a partially valid config that the user acknowledged
        const configWithDefaults = {
            ...config,
            llm: {
                ...config.llm,
                maxIterations: config.llm?.maxIterations ?? 50,
            },
        } as unknown as ValidatedAgentConfig;

        return configWithDefaults;
    }

    // Last resort: exit with helpful message
    console.log(chalk.rgb(255, 165, 0)('\nUnable to start with current configuration.'));
    showNextSteps();
    process.exit(1);
}
