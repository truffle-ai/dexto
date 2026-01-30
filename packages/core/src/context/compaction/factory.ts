import { z } from 'zod';
import type { ICompactionStrategy } from './types.js';
import type { CompactionContext, CompactionConfig } from './provider.js';
import { compactionRegistry } from './registry.js';
import { ContextError } from '../errors.js';

/**
 * Create a compaction strategy from configuration.
 *
 * Follows the same pattern as blob storage and tools:
 * - Validates provider exists
 * - Validates configuration with Zod schema
 * - Checks LLM requirements
 * - Creates strategy instance
 *
 * @param config - Compaction configuration from agent config
 * @param context - Context with logger and optional LanguageModel
 * @returns Strategy instance or null if disabled
 */
export async function createCompactionStrategy(
    config: CompactionConfig,
    context: CompactionContext
): Promise<ICompactionStrategy | null> {
    // If disabled, return null
    if (config.enabled === false) {
        context.logger.info(`Compaction provider '${config.type}' is disabled`);
        return null;
    }

    // Get provider
    const provider = compactionRegistry.get(config.type);
    if (!provider) {
        const available = compactionRegistry.getTypes();
        throw ContextError.compactionInvalidType(config.type, available);
    }

    // Validate configuration
    try {
        const validatedConfig = provider.configSchema.parse(config);

        // Check if LLM is required but not provided
        if (provider.metadata?.requiresLLM && !context.model) {
            throw ContextError.compactionMissingLLM(config.type);
        }

        // Create strategy instance
        const strategy = await provider.create(validatedConfig, context);

        context.logger.info(
            `Created compaction strategy: ${provider.metadata?.displayName || config.type}`
        );

        return strategy;
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw ContextError.compactionValidation(config.type, error.errors);
        }
        throw error;
    }
}
