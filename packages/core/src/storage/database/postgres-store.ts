import { Pool, PoolClient } from 'pg';
import type { Database } from './types.js';
import type { PostgresDatabaseConfig } from './schemas.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { StorageError } from '../errors.js';

/**
 * PostgreSQL database store for production database operations.
 * Implements the Database interface with connection pooling and JSONB support.
 * EXPERIMENTAL - NOT FULLY TESTED YET
 */
export class PostgresStore implements Database {
    private pool: Pool | null = null;
    private connected = false;
    private logger: IDextoLogger;

    constructor(
        private config: PostgresDatabaseConfig,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
    }

    async connect(): Promise<void> {
        if (this.connected) return;

        const connectionString = this.config.connectionString || this.config.url;

        // Validate connection string is not an unexpanded env variable
        if (connectionString?.startsWith('$')) {
            throw StorageError.connectionFailed(
                `PostgreSQL: Connection string contains unexpanded environment variable: ${connectionString}. ` +
                    `Ensure the environment variable is set in your .env file.`
            );
        }

        if (!connectionString) {
            throw StorageError.connectionFailed(
                'PostgreSQL: No connection string provided. Set url or connectionString in database config.'
            );
        }

        // Extract schema from options (custom option for schema-based isolation)
        const { schema, ...pgOptions } = (this.config.options || {}) as {
            schema?: string;
            [key: string]: unknown;
        };

        this.logger.info('Connecting to PostgreSQL database...');

        this.pool = new Pool({
            connectionString,
            max: this.config.maxConnections || 20,
            // Shorter idle timeout for serverless DBs (Neon) - connections go stale quickly
            idleTimeoutMillis: this.config.idleTimeoutMillis || 10000,
            connectionTimeoutMillis: this.config.connectionTimeoutMillis || 10000,
            // Enable TCP keepalive to detect dead connections
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
            ...pgOptions,
        });

        // Handle pool-level errors gracefully to prevent process crash
        this.pool.on('error', (err) => {
            this.logger.warn(`PostgreSQL pool error (will retry on next query): ${err.message}`);
            // Don't throw - the pool will create a new connection on next acquire
        });

        // Set search_path for every connection from the pool when using custom schema
        if (schema) {
            // Validate schema name to prevent SQL injection (alphanumeric and underscores only)
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
                throw StorageError.connectionFailed(
                    `PostgreSQL: Invalid schema name "${schema}". Schema names must start with a letter or underscore and contain only alphanumeric characters and underscores.`
                );
            }
            this.pool.on('connect', async (client) => {
                try {
                    await client.query(`SET search_path TO "${schema}", public`);
                } catch (err) {
                    this.logger.error(`Failed to set search_path to "${schema}": ${err}`);
                }
            });
            this.logger.info(`Using custom schema: "${schema}"`);
        }

        // Test connection with better error handling
        let client;
        try {
            client = await this.pool.connect();
            await client.query('SELECT NOW()');

            // Create schema if using custom schema
            if (schema) {
                await this.createSchema(client, schema);
            }

            await this.createTables(client);
            this.connected = true;
            this.logger.info('PostgreSQL database connected successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`PostgreSQL connection failed: ${errorMessage}`);

            // Clean up pool on failure
            if (this.pool) {
                await this.pool.end().catch(() => {});
                this.pool = null;
            }

            throw StorageError.connectionFailed(`PostgreSQL: ${errorMessage}`);
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    /**
     * Creates a PostgreSQL schema if it doesn't exist.
     */
    private async createSchema(client: PoolClient, schemaName: string): Promise<void> {
        // Validate schema name to prevent SQL injection (alphanumeric and underscores only)
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
            throw StorageError.connectionFailed(
                `PostgreSQL: Invalid schema name "${schemaName}". Schema names must start with a letter or underscore and contain only alphanumeric characters and underscores.`
            );
        }

        try {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
            this.logger.debug(`Schema "${schemaName}" ready`);
        } catch (error) {
            // Schema creation might fail due to permissions - that's OK if schema already exists
            this.logger.warn(
                `Could not create schema "${schemaName}": ${error}. Assuming it exists.`
            );
        }
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected && this.pool !== null;
    }

    getStoreType(): string {
        return 'postgres';
    }

    // Core operations - all use withRetry for serverless DB resilience
    async get<T>(key: string): Promise<T | undefined> {
        try {
            return await this.withRetry('get', async (client) => {
                const result = await client.query('SELECT value FROM kv WHERE key = $1', [key]);
                return result.rows[0] ? result.rows[0].value : undefined;
            });
        } catch (error) {
            throw StorageError.readFailed(
                'get',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        try {
            await this.withRetry('set', async (client) => {
                // Explicitly stringify for JSONB - the pg driver doesn't always handle this correctly
                const jsonValue = JSON.stringify(value);
                await client.query(
                    'INSERT INTO kv (key, value, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = $3',
                    [key, jsonValue, new Date()]
                );
            });
        } catch (error) {
            throw StorageError.writeFailed(
                'set',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async delete(key: string): Promise<void> {
        await this.withRetry('delete', async (client) => {
            await client.query('BEGIN');
            try {
                await client.query('DELETE FROM kv WHERE key = $1', [key]);
                await client.query('DELETE FROM lists WHERE key = $1', [key]);
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        });
    }

    // List operations
    async list(prefix: string): Promise<string[]> {
        return await this.withRetry('list', async (client) => {
            const kvResult = await client.query('SELECT key FROM kv WHERE key LIKE $1', [
                `${prefix}%`,
            ]);
            const listResult = await client.query(
                'SELECT DISTINCT key FROM lists WHERE key LIKE $1',
                [`${prefix}%`]
            );

            const allKeys = new Set([
                ...kvResult.rows.map((row) => row.key),
                ...listResult.rows.map((row) => row.key),
            ]);

            return Array.from(allKeys).sort();
        });
    }

    async append<T>(key: string, item: T): Promise<void> {
        try {
            await this.withRetry('append', async (client) => {
                // Explicitly stringify for JSONB - the pg driver doesn't always handle this correctly
                const jsonItem = JSON.stringify(item);
                await client.query(
                    'INSERT INTO lists (key, item, created_at) VALUES ($1, $2::jsonb, $3)',
                    [key, jsonItem, new Date()]
                );
            });
        } catch (error) {
            throw StorageError.writeFailed(
                'append',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        return await this.withRetry('getRange', async (client) => {
            const result = await client.query(
                'SELECT item FROM lists WHERE key = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
                [key, count, start]
            );
            return result.rows.map((row) => row.item);
        });
    }

    // Schema management
    private async createTables(client: PoolClient): Promise<void> {
        // Key-value table with JSONB support
        await client.query(`
      CREATE TABLE IF NOT EXISTS kv (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

        // Lists table with JSONB support
        await client.query(`
      CREATE TABLE IF NOT EXISTS lists (
        id BIGSERIAL PRIMARY KEY,
        key VARCHAR(255) NOT NULL,
        item JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

        // Indexes for performance
        await client.query('CREATE INDEX IF NOT EXISTS idx_kv_key ON kv(key)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_lists_key ON lists(key)');
        await client.query(
            'CREATE INDEX IF NOT EXISTS idx_lists_created_at ON lists(key, created_at DESC)'
        );
    }

    private checkConnection(): void {
        if (!this.connected || !this.pool) {
            throw StorageError.notConnected('PostgresStore');
        }
    }

    /**
     * Check if an error is a connection error that should trigger a retry.
     * Common with serverless databases (Neon) where connections go stale.
     */
    private isConnectionError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const code = (error as any).code;
        return (
            code === 'ETIMEDOUT' ||
            code === 'ECONNRESET' ||
            code === 'ECONNREFUSED' ||
            code === 'EPIPE' ||
            code === '57P01' || // admin_shutdown
            code === '57P02' || // crash_shutdown
            code === '57P03' || // cannot_connect_now
            error.message.includes('Connection terminated') ||
            error.message.includes('connection lost')
        );
    }

    /**
     * Execute a database operation with automatic retry on connection errors.
     * Handles serverless DB connection issues (Neon cold starts, stale connections).
     */
    private async withRetry<T>(
        operation: string,
        fn: (client: PoolClient) => Promise<T>,
        maxRetries = 2
    ): Promise<T> {
        this.checkConnection();

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            let client: PoolClient | undefined;
            try {
                client = await this.pool!.connect();
                const result = await fn(client);
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (client) {
                    // Release with error to remove potentially bad connection from pool
                    client.release(true);
                    client = undefined;
                }

                if (this.isConnectionError(error) && attempt < maxRetries) {
                    this.logger.warn(
                        `PostgreSQL ${operation} failed with connection error (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}. Retrying...`
                    );
                    // Brief delay before retry
                    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
                    continue;
                }

                throw error;
            } finally {
                if (client) {
                    client.release();
                }
            }
        }

        throw lastError;
    }

    // Advanced operations

    /**
     * Execute a callback within a database transaction.
     * Note: On connection failure, the entire callback will be retried on a new connection.
     * Ensure callback operations are idempotent or use this only for read operations.
     */
    async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        return await this.withRetry('transaction', async (client) => {
            await client.query('BEGIN');
            try {
                const result = await callback(client);
                await client.query('COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        });
    }

    async getStats(): Promise<{
        kvCount: number;
        listCount: number;
        totalSize: string;
    }> {
        return await this.withRetry('getStats', async (client) => {
            const kvResult = await client.query('SELECT COUNT(*) as count FROM kv');
            const listResult = await client.query('SELECT COUNT(*) as count FROM lists');
            const sizeResult = await client.query(
                'SELECT pg_size_pretty(pg_total_relation_size($1)) as size',
                ['kv']
            );

            return {
                kvCount: parseInt(kvResult.rows[0].count),
                listCount: parseInt(listResult.rows[0].count),
                totalSize: sizeResult.rows[0].size,
            };
        });
    }

    // Maintenance operations
    async vacuum(): Promise<void> {
        await this.withRetry('vacuum', async (client) => {
            await client.query('VACUUM ANALYZE kv, lists');
        });
    }
}
