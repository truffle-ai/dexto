import { z } from 'zod';
import { EnvExpandedString } from '@core/utils/result.js';
import { StorageErrorCode } from '../error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';

export const DATABASE_TYPES = ['in-memory', 'sqlite', 'postgres'] as const;
export type DatabaseType = (typeof DATABASE_TYPES)[number];

const BaseDatabaseSchema = z.object({
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

// Memory database - minimal configuration
export const InMemoryDatabaseSchema = BaseDatabaseSchema.extend({
    type: z.literal('in-memory'),
    // In-memory database doesn't need connection options, but inherits pool options for consistency
}).strict();

export type InMemoryDatabaseConfig = z.output<typeof InMemoryDatabaseSchema>;

// SQLite database configuration
export const SqliteDatabaseSchema = BaseDatabaseSchema.extend({
    type: z.literal('sqlite'),
    path: z
        .string()
        .describe(
            'SQLite database file path (required for SQLite - CLI enrichment provides per-agent path)'
        ),
}).strict();

export type SqliteDatabaseConfig = z.output<typeof SqliteDatabaseSchema>;

// PostgreSQL database configuration
export const PostgresDatabaseSchema = BaseDatabaseSchema.extend({
    type: z.literal('postgres'),
    url: EnvExpandedString().optional().describe('PostgreSQL connection URL (postgresql://...)'),
    connectionString: EnvExpandedString().optional().describe('PostgreSQL connection string'),
    host: z.string().optional().describe('PostgreSQL host'),
    port: z.number().int().positive().optional().describe('PostgreSQL port'),
    database: z.string().optional().describe('PostgreSQL database name'),
    password: z.string().optional().describe('PostgreSQL password'),
    // TODO: keyPrefix is reserved for future use - allows namespacing keys when multiple
    // agents or environments share the same database (e.g., "dev:agent1:" vs "prod:agent2:")
    keyPrefix: z
        .string()
        .optional()
        .describe('Optional key prefix for namespacing (e.g., "dev:myagent:")'),
}).strict();

export type PostgresDatabaseConfig = z.output<typeof PostgresDatabaseSchema>;

// Database configuration using discriminated union
export const DatabaseConfigSchema = z
    .discriminatedUnion(
        'type',
        [InMemoryDatabaseSchema, SqliteDatabaseSchema, PostgresDatabaseSchema],
        {
            errorMap: (issue, ctx) => {
                if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
                    return {
                        message: `Invalid database type. Expected 'in-memory', 'sqlite', or 'postgres'.`,
                    };
                }
                return { message: ctx.defaultError };
            },
        }
    )
    .describe('Database configuration')
    .superRefine((data, ctx) => {
        // Validate PostgreSQL requirements
        if (data.type === 'postgres') {
            if (!data.url && !data.connectionString && !data.host) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        "PostgreSQL database requires one of 'url', 'connectionString', or 'host' to be specified",
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

export type DatabaseConfig = z.output<typeof DatabaseConfigSchema>;
