import { Pool, PoolClient } from 'pg';
import type { DatabaseBackend } from './database-backend.js';
import type { PostgresBackendConfig } from '../schemas.js';
import { StorageError } from '../errors.js';

/**
 * PostgreSQL storage backend for production database operations.
 * Implements the DatabaseBackend interface with connection pooling and JSONB support.
 * EXPERIMENTAL - NOT FULLY TESTED YET
 */
export class PostgresBackend implements DatabaseBackend {
    private pool: Pool | null = null;
    private connected = false;

    constructor(private config: PostgresBackendConfig) {}

    async connect(): Promise<void> {
        if (this.connected) return;

        this.pool = new Pool({
            connectionString: this.config.connectionString || this.config.url,
            max: this.config.maxConnections || 20,
            idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
            connectionTimeoutMillis: this.config.connectionTimeoutMillis || 2000,
            ...this.config.options,
        });

        // Test connection
        const client = await this.pool.connect();
        try {
            await client.query('SELECT NOW()');
            await this.createTables(client);
            this.connected = true;
        } finally {
            client.release();
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

    getBackendType(): string {
        return 'postgres';
    }

    // Core operations
    async get<T>(key: string): Promise<T | undefined> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            const result = await client.query('SELECT value FROM kv WHERE key = $1', [key]);
            return result.rows[0] ? result.rows[0].value : undefined;
        } finally {
            client.release();
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.checkConnection();
        const client = await this.pool!.connect();
        try {
            await client.query(
                'INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3',
                [key, JSON.stringify(value), new Date()]
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
            await client.query('INSERT INTO lists (key, item, created_at) VALUES ($1, $2, $3)', [
                key,
                JSON.stringify(item),
                new Date(),
            ]);
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
            return result.rows.map((row) => JSON.parse(row.item));
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
            throw StorageError.notConnected('PostgresBackend');
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
