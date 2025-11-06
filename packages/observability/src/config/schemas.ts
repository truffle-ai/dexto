import { z } from 'zod';

/**
 * Observability configuration schema
 */
export const ObservabilityConfigSchema = z.object({
    enabled: z.boolean().default(true).describe('Enable observability features'),
    retention: z.string().default('7d').describe('Trace retention period (e.g., 7d, 30d)'),
    keyPrefix: z.string().default('trace:').describe('Storage key prefix for traces'),
    autoCleanup: z.boolean().default(true).describe('Automatically cleanup old traces'),
    cleanupInterval: z.number().default(3600000).describe('Cleanup interval in milliseconds'),
    dashboard: z
        .object({
            enabled: z.boolean().default(true).describe('Enable dashboard UI'),
        })
        .optional(),
});

export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;
