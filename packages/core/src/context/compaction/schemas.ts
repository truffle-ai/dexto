import { z } from 'zod';

/**
 * Base compaction configuration schema.
 * Uses discriminated union to support different provider types.
 *
 * Each provider registers its own schema with specific validation rules.
 * This schema accepts any configuration with a 'type' field.
 */
export const CompactionConfigSchema = z
    .object({
        type: z.string().describe('Compaction provider type'),
        enabled: z.boolean().default(true).describe('Enable or disable compaction'),
    })
    .passthrough() // Allow additional fields that will be validated by provider schemas
    .describe('Context compaction configuration');

export type CompactionConfigInput = z.output<typeof CompactionConfigSchema>;

/**
 * Default compaction configuration - uses reactive-overflow strategy
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfigInput = {
    type: 'reactive-overflow',
    enabled: true,
};
