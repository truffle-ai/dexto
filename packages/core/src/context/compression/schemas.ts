import { z } from 'zod';

/**
 * Base compression configuration schema.
 * Uses discriminated union to support different provider types.
 *
 * Each provider registers its own schema with specific validation rules.
 * This schema accepts any configuration with a 'type' field.
 */
export const CompressionConfigSchema = z
    .object({
        type: z.string().describe('Compression provider type'),
        enabled: z.boolean().default(true).describe('Enable or disable compression'),
    })
    .passthrough() // Allow additional fields that will be validated by provider schemas
    .describe('Context compression configuration');

export type CompressionConfigInput = z.output<typeof CompressionConfigSchema>;

/**
 * Default compression configuration - uses reactive-overflow strategy
 */
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfigInput = {
    type: 'reactive-overflow',
    enabled: true,
};
