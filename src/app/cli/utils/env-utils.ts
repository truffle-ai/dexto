// src/app/cli/utils/env-utils.ts

import chalk from 'chalk';
import { logger } from '@core/index.js';
import { type LLMProvider } from '@core/llm/registry.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { updateEnvFile } from '@core/utils/env.js';

/**
 * Updates .env file with API key for specified LLM provider
 * @param envFilePath Path to .env file
 * @param llmProvider LLM provider
 * @param llmApiKey API key value
 */
export async function updateEnvFileWithLLMKeys(
    envFilePath: string,
    llmProvider?: LLMProvider,
    llmApiKey?: string
): Promise<void> {
    logger.debug(`Updating .env file with dexto env variables: envFilePath ${envFilePath}`);

    // Build updates object for the specific provider
    const updates: Record<string, string> = {};
    if (llmProvider && llmApiKey) {
        const envVar = getPrimaryApiKeyEnvVar(llmProvider);
        updates[envVar] = llmApiKey;
    }

    // Use the generic env file writer
    await updateEnvFile(envFilePath, updates);

    // Log where the API key was written for visibility
    if (llmProvider && llmApiKey) {
        console.log(chalk.green(`✓ Wrote ${llmProvider.toUpperCase()} API key to: ${envFilePath}`));
    }
}
