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
            idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
            connectionTimeoutMillis: this.config.connectionTimeoutMillis || 2000,
            ...pgOptions,
        });

        // Set search_path for every connection from the pool when using custom schema
        if (schema) {
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

    // Core operations
    async get<T>(key: string): Promise<T | undefined> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            const result = await client.query('SELECT value FROM kv WHERE key = $1', [key]);
            return result.rows[0] ? result.rows[0].value : undefined;
        } catch (error) {
            throw StorageError.readFailed(
                'get',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        } finally {
            client.release();
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            // Explicitly stringify for JSONB - the pg driver doesn't always handle this correctly
            const jsonValue = JSON.stringify(value);
            await client.query(
                'INSERT INTO kv (key, value, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = $3',
                [key, jsonValue, new Date()]
            );
        } catch (error) {
            throw StorageError.writeFailed(
                'set',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        } finally {
            client.release();
        }
    }

    async delete(key: string): Promise<void> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM kv WHERE key = $1', [key]);
            await client.query('DELETE FROM lists WHERE key = $1', [key]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // List operations
    async list(prefix: string): Promise<string[]> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
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
        } finally {
            client.release();
        }
    }

    async append<T>(key: string, item: T): Promise<void> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            // Explicitly stringify for JSONB - the pg driver doesn't always handle this correctly
            const jsonItem = JSON.stringify(item);
            await client.query(
                'INSERT INTO lists (key, item, created_at) VALUES ($1, $2::jsonb, $3)',
                [key, jsonItem, new Date()]
            );
        } catch (error) {
            throw StorageError.writeFailed(
                'append',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        } finally {
            client.release();
        }
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            const result = await client.query(
                'SELECT item FROM lists WHERE key = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
                [key, count, start]
            );
            return result.rows.map((row) => row.item);
        } finally {
            client.release();
        }
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

    // Advanced operations
    async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getStats(): Promise<{
        kvCount: number;
        listCount: number;
        totalSize: string;
    }> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
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
        } finally {
            client.release();
        }
    }

    // Maintenance operations
    async vacuum(): Promise<void> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            await client.query('VACUUM ANALYZE kv, lists');
        } finally {
            client.release();
        }
    }
}
