import { z } from 'zod';
import type { LanguageModel } from 'ai';
import type { ICompressionStrategy } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';

/**
 * Context provided to compression strategy creation
 */
export interface CompressionContext {
    logger: IDextoLogger;
    model?: LanguageModel; // Optional - some strategies may not need LLM
}

/**
 * Provider interface for compression strategies.
 *
 * Follows the same pattern as blob storage and tools providers:
 * - Type discriminator for config validation
 * - Zod schema for runtime validation
 * - Factory function to create instances
 * - Metadata for discovery and UI
 *
 * TConfig should be the output type (z.output) with defaults applied
 */
export interface CompressionProvider<
    TType extends string = string,
    TConfig extends CompressionConfig = CompressionConfig,
> {
    /** Unique identifier for this strategy type */
    type: TType;

    /** Zod schema for validating configuration - accepts input, produces TConfig output */
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, any>;

    /** Metadata for discovery and UI */
    metadata?: {
        displayName: string;
        description: string;
        requiresLLM: boolean; // Does it need LLM access?
        isProactive: boolean; // Proactive vs reactive?
    };

    /**
     * Create a compression strategy instance
     * @param config - Validated configuration with defaults applied (output type)
     */
    create(
        config: TConfig,
        context: CompressionContext
    ): ICompressionStrategy | Promise<ICompressionStrategy>;
}

/**
 * Base configuration for all compression strategies
 */
export interface CompressionConfig {
    type: string;
    enabled?: boolean; // Allow disabling without removing config
}
