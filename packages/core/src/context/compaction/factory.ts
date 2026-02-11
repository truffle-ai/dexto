import { z } from 'zod';
import type { ICompactionStrategy } from './types.js';
import type { CompactionContext, CompactionConfig, CompactionProvider } from './provider.js';
import { ContextError } from '../errors.js';
import { noopProvider } from './providers/noop-provider.js';
import { reactiveOverflowProvider } from './providers/reactive-overflow-provider.js';

// Compaction strategies remain core-owned for now (reactive-overflow requires a per-session LanguageModel).

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

    const createFromProvider = async <TConfig extends CompactionConfig>(
        provider: CompactionProvider<string, TConfig>
    ): Promise<ICompactionStrategy> => {
        const validatedConfig = provider.configSchema.parse(config);

        // Check if LLM is required but not provided
        if (provider.metadata?.requiresLLM && !context.model) {
            throw ContextError.compactionMissingLLM(config.type);
        }

        const strategy = await provider.create(validatedConfig, context);

        context.logger.info(
            `Created compaction strategy: ${provider.metadata?.displayName || config.type}`
        );

        return strategy;
    };

    // Validate configuration
    try {
        switch (config.type) {
            case reactiveOverflowProvider.type:
                return await createFromProvider(reactiveOverflowProvider);
            case noopProvider.type:
                return await createFromProvider(noopProvider);
            default:
                throw ContextError.compactionInvalidType(config.type, [
                    reactiveOverflowProvider.type,
                    noopProvider.type,
                ]);
        }
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw ContextError.compactionValidation(config.type, error.errors);
        }
        throw error;
    }
}
