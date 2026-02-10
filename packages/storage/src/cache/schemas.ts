import { z } from 'zod';
import { EnvExpandedString, ErrorScope, ErrorType, StorageErrorCode } from '@dexto/core';

export const CACHE_TYPES = ['in-memory', 'redis'] as const;
export type CacheType = (typeof CACHE_TYPES)[number];

const BaseCacheSchema = z.object({
    maxConnections: z.number().int().positive().optional().describe('Maximum connections'),
    idleTimeoutMillis: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Idle timeout in milliseconds'),
    connectionTimeoutMillis: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Connection timeout in milliseconds'),
    options: z.record(z.any()).optional().describe('Backend-specific options'),
});

// Memory cache - minimal configuration
export const InMemoryCacheSchema = BaseCacheSchema.extend({
    type: z.literal('in-memory'),
    // In-memory cache doesn't need connection options, but inherits pool options for consistency
}).strict();

export type InMemoryCacheConfig = z.output<typeof InMemoryCacheSchema>;

// Redis cache configuration
export const RedisCacheSchema = BaseCacheSchema.extend({
    type: z.literal('redis'),
    url: EnvExpandedString().optional().describe('Redis connection URL (redis://...)'),
    host: z.string().optional().describe('Redis host'),
    port: z.number().int().positive().optional().describe('Redis port'),
    password: z.string().optional().describe('Redis password'),
    database: z.number().int().nonnegative().optional().describe('Redis database number'),
}).strict();

export type RedisCacheConfig = z.output<typeof RedisCacheSchema>;

// Cache configuration using discriminated union
export const CacheConfigSchema = z
    .discriminatedUnion('type', [InMemoryCacheSchema, RedisCacheSchema], {
        errorMap: (issue, ctx) => {
            if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
                return {
                    message: `Invalid cache type. Expected 'in-memory' or 'redis'.`,
                };
            }
            return { message: ctx.defaultError };
        },
    })
    .describe('Cache configuration')
    .superRefine((data, ctx) => {
        // Validate Redis requirements
        if (data.type === 'redis') {
            if (!data.url && !data.host) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Redis cache requires either 'url' or 'host' to be specified",
                    path: ['url'],
                    params: {
                        code: StorageErrorCode.CONNECTION_CONFIG_MISSING,
                        scope: ErrorScope.STORAGE,
                        type: ErrorType.USER,
                    },
                });
            }
        }
    });

export type CacheConfig = z.output<typeof CacheConfigSchema>;
