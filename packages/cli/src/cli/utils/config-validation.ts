import { z } from 'zod';
import chalk from 'chalk';
import { AgentConfigSchema, type AgentConfig } from '@dexto/core';
import { interactiveApiKeySetup } from './api-key-setup.js';
import { LLMErrorCode } from '@dexto/core';
import type { LLMProvider } from '@dexto/core';
import { noOpLogger } from '@dexto/core';

/**
 * Validates agent config with optional interactive fixes for user experience.
 * Uses schema parsing to detect API key issues and provides targeted setup.
 * Returns validated AgentConfig.
 */
export async function validateAgentConfig(
    config: AgentConfig,
    interactive: boolean = false
): Promise<AgentConfig> {
    // Parse with schema to detect issues
    const parseResult = AgentConfigSchema.safeParse(config);

    if (!parseResult.success) {
        // Check for API key validation errors using raw Zod error (preserves params)
        noOpLogger.error(`Agent config validation error: ${JSON.stringify(parseResult.error)}`);
        const apiKeyError = findApiKeyError(parseResult.error, config);

        if (apiKeyError && interactive) {
            noOpLogger.debug(
                `API key error found for ${apiKeyError.provider} provider, retriggering interactive setup`
            );
            console.log(
                chalk.yellow(`\n🔑 API key required for ${apiKeyError.provider} provider\n`)
            );

            // Run interactive setup for the specific provider that failed
            // Function will exit process if user cancels, otherwise continues
            // Environment variables are automatically reloaded after API key setup
            await interactiveApiKeySetup(apiKeyError.provider);
            // Same config, but EnvExpandedString will now find the API key
            return validateAgentConfig(config, interactive);
        }

        // API key error in non-interactive mode or other validation errors
        console.error(chalk.red('❌ Configuration Error:'));
        formatZodError(parseResult.error);
        process.exit(1);
    }

    // Return the validated config
    return parseResult.data;
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
function formatZodError(error: z.ZodError): void {
    for (const issue of error.issues) {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
        console.error(chalk.red(`  • ${path}: ${issue.message}`));
    }
}
