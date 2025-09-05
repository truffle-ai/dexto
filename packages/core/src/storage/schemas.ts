import { z } from 'zod';
import { StorageErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';

// ==== STORAGE CONFIGURATION ====
// Base schema for common connection pool options
const BaseBackendSchema = z.object({
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
// Memory backend - minimal configuration
const InMemoryBackendSchema = BaseBackendSchema.extend({
    type: z.literal('in-memory'),
    // In-memory backend doesn't need connection options, but inherits pool options for consistency
}).strict();

export type InMemoryBackendConfig = z.output<typeof InMemoryBackendSchema>;
// Redis backend configuration
const RedisBackendSchema = BaseBackendSchema.extend({
    type: z.literal('redis'),
    url: z.string().optional().describe('Redis connection URL (redis://...)'),
    host: z.string().optional().describe('Redis host'),
    port: z.number().int().positive().optional().describe('Redis port'),
    password: z.string().optional().describe('Redis password'),
    database: z.number().int().nonnegative().optional().describe('Redis database number'),
}).strict();

export type RedisBackendConfig = z.output<typeof RedisBackendSchema>;
// SQLite backend configuration
const SqliteBackendSchema = BaseBackendSchema.extend({
    type: z.literal('sqlite'),
    path: z
        .string()
        .optional()
        .describe(
            'SQLite database file path (optional, will auto-detect using path resolver if not provided)'
        ),
    database: z.string().optional().describe('Database filename (default: dexto.db)'),
}).strict();

export type SqliteBackendConfig = z.output<typeof SqliteBackendSchema>;
// PostgreSQL backend configuration
const PostgresBackendSchema = BaseBackendSchema.extend({
    type: z.literal('postgres'),
    url: z.string().optional().describe('PostgreSQL connection URL (postgresql://...)'),
    connectionString: z.string().optional().describe('PostgreSQL connection string'),
    host: z.string().optional().describe('PostgreSQL host'),
    port: z.number().int().positive().optional().describe('PostgreSQL port'),
    database: z.string().optional().describe('PostgreSQL database name'),
    password: z.string().optional().describe('PostgreSQL password'),
}).strict();

export type PostgresBackendConfig = z.output<typeof PostgresBackendSchema>;
// Backend configuration using discriminated union
const BackendConfigSchema = z
    .discriminatedUnion(
        'type',
        [InMemoryBackendSchema, RedisBackendSchema, SqliteBackendSchema, PostgresBackendSchema],
        {
            errorMap: (issue, ctx) => {
                if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
                    return {
                        message: `Invalid backend type. Expected 'in-memory', 'redis', 'sqlite', or 'postgres'.`,
                    };
                }
                return { message: ctx.defaultError };
            },
        }
    )
    .describe('Backend configuration for storage system')
    .superRefine((data, ctx) => {
        // Validate Redis backend requirements
        if (data.type === 'redis') {
            if (!data.url && !data.host) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Redis backend requires either 'url' or 'host' to be specified",
                    path: ['url'],
                    params: {
                        code: StorageErrorCode.CONNECTION_CONFIG_MISSING,
                        scope: ErrorScope.STORAGE,
                        type: ErrorType.USER,
                    },
                });
            }
        }

        // Validate PostgreSQL backend requirements
        if (data.type === 'postgres') {
            if (!data.url && !data.connectionString && !data.host) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        "PostgreSQL backend requires one of 'url', 'connectionString', or 'host' to be specified",
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

export type BackendConfig = z.output<typeof BackendConfigSchema>;
// Storage configuration with cache and database backends

export const StorageSchema = z
    .object({
        cache: BackendConfigSchema.describe('Cache backend configuration (fast, ephemeral)'),
        database: BackendConfigSchema.describe(
            'Database backend configuration (persistent, reliable)'
        ),
    })
    .strict()
    .describe('Storage configuration with cache and database backends')
    .brand<'ValidatedStorageConfig'>();

export type StorageConfig = z.input<typeof StorageSchema>;
export type ValidatedStorageConfig = z.output<typeof StorageSchema>;
