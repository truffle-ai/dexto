import { z } from 'zod';
import type { LanguageModel } from 'ai';
import type { ICompactionStrategy } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';

/**
 * Context provided to compaction strategy creation
 */
export interface CompactionContext {
    logger: IDextoLogger;
    model?: LanguageModel; // Optional - some strategies may not need LLM
}

/**
 * Provider interface for compaction strategies.
 *
 * Follows the same pattern as blob storage and tools providers:
 * - Type discriminator for config validation
 * - Zod schema for runtime validation
 * - Factory function to create instances
 * - Metadata for discovery and UI
 *
 * TConfig should be the output type (z.output) with defaults applied
 */
export interface CompactionProvider<
    TType extends string = string,
    TConfig extends CompactionConfig = CompactionConfig,
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
     * Create a compaction strategy instance
     * @param config - Validated configuration with defaults applied (output type)
     */
    create(
        config: TConfig,
        context: CompactionContext
    ): ICompactionStrategy | Promise<ICompactionStrategy>;
}

/**
 * Base configuration for all compaction strategies
 */
export interface CompactionConfig {
    type: string;
    enabled?: boolean; // Allow disabling without removing config
}
