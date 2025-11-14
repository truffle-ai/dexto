import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    StorageSchema,
    type StorageConfig,
    type InMemoryCacheConfig,
    type RedisCacheConfig,
    type InMemoryDatabaseConfig,
    type SqliteDatabaseConfig,
    type PostgresDatabaseConfig,
    type CacheConfig,
    type DatabaseConfig,
} from './schemas.js';

// Test helper: default blob config for tests
const testBlobConfig = { type: 'local' as const, storePath: '/tmp/test-blobs' };

describe('StorageSchema', () => {
    describe('Backend Configuration - In-Memory', () => {
        it('should accept minimal in-memory backend config', () => {
            const config = { type: 'in-memory' as const };
            const result = StorageSchema.safeParse({
                cache: config,
                database: config,
                blob: testBlobConfig,
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.cache.type).toBe('in-memory');
                expect(result.data.database.type).toBe('in-memory');
            }
        });

        it('should accept in-memory backend with optional connection options', () => {
            const cacheConfig: InMemoryCacheConfig = {
                type: 'in-memory',
                maxConnections: 10,
                idleTimeoutMillis: 5000,
                connectionTimeoutMillis: 3000,
            };

            const dbConfig: InMemoryDatabaseConfig = {
                type: 'in-memory',
                maxConnections: 10,
                idleTimeoutMillis: 5000,
                connectionTimeoutMillis: 3000,
            };

            const result = StorageSchema.safeParse({
                cache: cacheConfig,
                database: dbConfig,
                blob: testBlobConfig,
            });
            expect(result.success).toBe(true);
        });
    });

    describe('Backend Configuration - Redis', () => {
        it('should accept Redis backend with URL', () => {
            const config: RedisCacheConfig = {
                type: 'redis',
                url: 'redis://localhost:6379',
            };

            const result = StorageSchema.parse({
                cache: config,
                database: { type: 'in-memory' },
                blob: testBlobConfig,
            });
            expect(result.cache.type).toBe('redis');
            if (result.cache.type === 'redis') {
                expect(result.cache.url).toBe('redis://localhost:6379');
            }
        });

        it('should accept Redis backend with host/port', () => {
            const config: RedisCacheConfig = {
                type: 'redis',
                host: 'localhost',
                port: 6379,
                password: 'secret',
                database: 0,
            };

            const result = StorageSchema.parse({
                cache: config,
                database: { type: 'in-memory' },
                blob: testBlobConfig,
            });
            expect(result.cache.type).toBe('redis');
            if (result.cache.type === 'redis') {
                expect(result.cache.host).toBe('localhost');
            }
        });

        it('should reject Redis backend without URL or host', () => {
            const config = { type: 'redis' };

            const result = StorageSchema.safeParse({
                cache: config,
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
            expect(result.error?.issues[0]?.message).toContain('Redis cache requires either');
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'url']);
        });
    });

    describe('Backend Configuration - SQLite', () => {
        it('should accept SQLite backend with path', () => {
            const config: SqliteDatabaseConfig = {
                type: 'sqlite',
                path: '/tmp/db/dexto.db',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            });
            expect(result.database.type).toBe('sqlite');
            if (result.database.type === 'sqlite') {
                expect(result.database.path).toBe('/tmp/db/dexto.db');
            }
        });
    });

    describe('Backend Configuration - PostgreSQL', () => {
        it('should accept PostgreSQL backend with URL', () => {
            const config: PostgresDatabaseConfig = {
                type: 'postgres',
                url: 'postgresql://user:pass@localhost:5432/dexto',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
                blob: testBlobConfig,
            });
            expect(result.database.type).toBe('postgres');
            if (result.database.type === 'postgres') {
                expect(result.database.url).toBe('postgresql://user:pass@localhost:5432/dexto');
            }
        });

        it('should accept PostgreSQL backend with connection string', () => {
            const config: PostgresDatabaseConfig = {
                type: 'postgres',
                connectionString: 'postgresql://user:pass@localhost:5432/dexto',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
                blob: testBlobConfig,
            });
            expect(result.database.type).toBe('postgres');
            if (result.database.type === 'postgres') {
                expect(result.database.connectionString).toBe(
                    'postgresql://user:pass@localhost:5432/dexto'
                );
            }
        });

        it('should accept PostgreSQL backend with host/port details', () => {
            const config: PostgresDatabaseConfig = {
                type: 'postgres',
                host: 'localhost',
                port: 5432,
                database: 'dexto',
                password: 'secret',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
                blob: testBlobConfig,
            });
            expect(result.database.type).toBe('postgres');
            if (result.database.type === 'postgres') {
                expect(result.database.host).toBe('localhost');
                expect(result.database.port).toBe(5432);
            }
        });

        it('should reject PostgreSQL backend without connection info', () => {
            const config = { type: 'postgres' };

            const result = StorageSchema.safeParse({
                cache: { type: 'in-memory' },
                database: config,
                blob: testBlobConfig,
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
            expect(result.error?.issues[0]?.message).toContain(
                'PostgreSQL database requires one of'
            );
            expect(result.error?.issues[0]?.path).toEqual(['database', 'url']);
        });
    });

    describe('Discriminated Union Validation', () => {
        it('should reject invalid backend type', () => {
            const config = { type: 'invalid-backend' };

            const result = StorageSchema.safeParse({
                cache: config,
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_union_discriminator);
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'type']);
        });

        it('should provide clear error messages for invalid discriminator', () => {
            const config = { type: 'nosql' };

            const result = StorageSchema.safeParse({
                cache: config,
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_union_discriminator);
            expect(result.error?.issues[0]?.message).toContain('Invalid cache type');
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'type']);
        });
    });

    describe('Connection Pool Options', () => {
        it('should validate positive connection limits', () => {
            // Negative connections should fail
            let result = StorageSchema.safeParse({
                cache: { type: 'in-memory', maxConnections: -1 },
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'maxConnections']);

            // Zero connections should fail
            result = StorageSchema.safeParse({
                cache: { type: 'in-memory', maxConnections: 0 },
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'maxConnections']);

            // Positive connections should succeed
            const validResult = StorageSchema.parse({
                cache: { type: 'in-memory', maxConnections: 10 },
                database: { type: 'in-memory' },
                blob: testBlobConfig,
            });
            expect(validResult.cache.maxConnections).toBe(10);
        });

        it('should validate positive timeout values', () => {
            // Negative idle timeout should fail
            let result = StorageSchema.safeParse({
                cache: { type: 'in-memory', idleTimeoutMillis: -1 },
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'idleTimeoutMillis']);

            // Zero connection timeout should fail
            result = StorageSchema.safeParse({
                cache: { type: 'in-memory', connectionTimeoutMillis: 0 },
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'connectionTimeoutMillis']);

            // Positive timeout should succeed
            const validResult = StorageSchema.parse({
                cache: { type: 'in-memory', idleTimeoutMillis: 5000 },
                database: { type: 'in-memory' },
                blob: testBlobConfig,
            });
            expect(validResult.cache.idleTimeoutMillis).toBe(5000);
        });
    });

    describe('Strict Validation', () => {
        it('should reject extra fields on backend configs', () => {
            const configWithExtra = {
                type: 'in-memory',
                unknownField: 'should fail',
            };

            const result = StorageSchema.safeParse({
                cache: configWithExtra,
                database: { type: 'in-memory' },
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
            expect(result.error?.issues[0]?.path).toEqual(['cache']);
        });

        it('should reject extra fields on storage config', () => {
            const configWithExtra = {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: testBlobConfig,
                unknownField: 'should fail',
            };

            const result = StorageSchema.safeParse(configWithExtra);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should have correct type inference for different backends', () => {
            const config: StorageConfig = {
                cache: { type: 'redis', url: 'redis://localhost:6379' },
                database: { type: 'postgres', url: 'postgresql://localhost/dexto' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            };

            const result = StorageSchema.safeParse(config);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.cache.type).toBe('redis');
                expect(result.data.database.type).toBe('postgres');
            }
        });

        it('should handle cache config type unions correctly', () => {
            const cacheConfigs: CacheConfig[] = [
                { type: 'in-memory' },
                { type: 'redis', url: 'redis://localhost:6379' },
            ];

            cacheConfigs.forEach((cacheConfig) => {
                const result = StorageSchema.parse({
                    cache: cacheConfig,
                    database: { type: 'in-memory' },
                    blob: testBlobConfig,
                });
                expect(result.cache.type).toBe(cacheConfig.type);
            });
        });

        it('should handle database config type unions correctly', () => {
            const dbConfigs: DatabaseConfig[] = [
                { type: 'in-memory' },
                { type: 'sqlite', path: '/tmp/db/test.db' },
                { type: 'postgres', url: 'postgresql://localhost/test' },
            ];

            dbConfigs.forEach((dbConfig) => {
                const result = StorageSchema.parse({
                    cache: { type: 'in-memory' },
                    database: dbConfig,
                    blob: { type: 'local', storePath: '/tmp/test-blobs' },
                });
                expect(result.database.type).toBe(dbConfig.type);
            });
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle typical development configuration', () => {
            const devConfig: StorageConfig = {
                cache: { type: 'in-memory' },
                database: { type: 'sqlite', path: './dev-db/dev.db' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            };

            const result = StorageSchema.safeParse(devConfig);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toMatchObject(devConfig);
            }
        });

        it('should handle production configuration with Redis cache', () => {
            const prodConfig: StorageConfig = {
                cache: {
                    type: 'redis',
                    url: 'redis://cache.example.com:6379',
                    maxConnections: 50,
                    idleTimeoutMillis: 30000,
                },
                database: {
                    type: 'postgres',
                    url: 'postgresql://user:pass@db.example.com:5432/dexto',
                    maxConnections: 20,
                    connectionTimeoutMillis: 5000,
                },
                blob: { type: 'local', storePath: '/var/dexto/blobs' },
            };

            const result = StorageSchema.safeParse(prodConfig);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toMatchObject(prodConfig);
            }
        });

        it('should handle high-availability configuration', () => {
            const haConfig: StorageConfig = {
                cache: {
                    type: 'redis',
                    host: 'redis-cluster.example.com',
                    port: 6379,
                    password: 'cluster-secret',
                    maxConnections: 100,
                },
                database: {
                    type: 'postgres',
                    host: 'postgres-primary.example.com',
                    port: 5432,
                    database: 'dexto_prod',
                    password: 'db-secret',
                    maxConnections: 50,
                },
                blob: { type: 'local', storePath: '/var/dexto/blobs' },
            };

            const result = StorageSchema.safeParse(haConfig);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toMatchObject(haConfig);
            }
        });
    });
});
