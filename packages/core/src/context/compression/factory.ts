import { z } from 'zod';
import type { ICompressionStrategy } from './types.js';
import type { CompressionContext, CompressionConfig } from './provider.js';
import { compressionRegistry } from './registry.js';
import { ContextError } from '../errors.js';

/**
 * Create a compression strategy from configuration.
 *
 * Follows the same pattern as blob storage and tools:
 * - Validates provider exists
 * - Validates configuration with Zod schema
 * - Checks LLM requirements
 * - Creates strategy instance
 *
 * @param config - Compression configuration from agent config
 * @param context - Context with logger and optional LanguageModel
 * @returns Strategy instance or null if disabled
 */
export async function createCompressionStrategy(
    config: CompressionConfig,
    context: CompressionContext
): Promise<ICompressionStrategy | null> {
    // If disabled, return null
    if (config.enabled === false) {
        context.logger.info(`Compression provider '${config.type}' is disabled`);
        return null;
    }

    // Get provider
    const provider = compressionRegistry.get(config.type);
    if (!provider) {
        const available = compressionRegistry.getTypes();
        throw ContextError.compressionInvalidType(config.type, available);
    }

    // Validate configuration
    try {
        const validatedConfig = provider.configSchema.parse(config);

        // Check if LLM is required but not provided
        if (provider.metadata?.requiresLLM && !context.model) {
            throw ContextError.compressionMissingLLM(config.type);
        }

        // Create strategy instance
        const strategy = await provider.create(validatedConfig, context);

        context.logger.info(
            `Created compression strategy: ${provider.metadata?.displayName || config.type}`
        );

        return strategy;
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw ContextError.compressionValidation(config.type, error.errors);
        }
        throw error;
    }
}
