import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    StorageSchema,
    type StorageConfig,
    type InMemoryBackendConfig,
    type RedisBackendConfig,
    type SqliteBackendConfig,
    type PostgresBackendConfig,
    type BackendConfig,
} from './schemas.js';

describe('StorageSchema', () => {
    describe('Backend Configuration - In-Memory', () => {
        it('should accept minimal in-memory backend config', () => {
            const config = { type: 'in-memory' as const };
            const result = StorageSchema.safeParse({
                cache: config,
                database: config,
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.cache.type).toBe('in-memory');
                expect(result.data.database.type).toBe('in-memory');
            }
        });

        it('should accept in-memory backend with optional connection options', () => {
            const config: InMemoryBackendConfig = {
                type: 'in-memory',
                maxConnections: 10,
                idleTimeoutMillis: 5000,
                connectionTimeoutMillis: 3000,
            };

            const result = StorageSchema.safeParse({
                cache: config,
                database: config,
            });
            expect(result.success).toBe(true);
        });
    });

    describe('Backend Configuration - Redis', () => {
        it('should accept Redis backend with URL', () => {
            const config: RedisBackendConfig = {
                type: 'redis',
                url: 'redis://localhost:6379',
            };

            const result = StorageSchema.parse({
                cache: config,
                database: { type: 'in-memory' },
            });
            expect(result.cache.type).toBe('redis');
            if (result.cache.type === 'redis') {
                expect(result.cache.url).toBe('redis://localhost:6379');
            }
        });

        it('should accept Redis backend with host/port', () => {
            const config: RedisBackendConfig = {
                type: 'redis',
                host: 'localhost',
                port: 6379,
                password: 'secret',
                database: 0,
            };

            const result = StorageSchema.parse({
                cache: config,
                database: { type: 'in-memory' },
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
            expect(result.error?.issues[0]?.message).toContain('Redis backend requires either');
            expect(result.error?.issues[0]?.path).toEqual(['cache', 'url']);
        });
    });

    describe('Backend Configuration - SQLite', () => {
        it('should accept SQLite backend with path', () => {
            const config: SqliteBackendConfig = {
                type: 'sqlite',
                path: '/tmp/dexto.db',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
            });
            expect(result.database.type).toBe('sqlite');
            if (result.database.type === 'sqlite') {
                expect(result.database.path).toBe('/tmp/dexto.db');
            }
        });

        it('should accept SQLite backend with database filename', () => {
            const config: SqliteBackendConfig = {
                type: 'sqlite',
                database: 'dexto.db',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
            });
            expect(result.database.type).toBe('sqlite');
            if (result.database.type === 'sqlite') {
                expect(result.database.database).toBe('dexto.db');
            }
        });

        it('should accept SQLite backend with minimal config', () => {
            const config = { type: 'sqlite' as const };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
            });
            expect(result.database.type).toBe('sqlite');
        });
    });

    describe('Backend Configuration - PostgreSQL', () => {
        it('should accept PostgreSQL backend with URL', () => {
            const config: PostgresBackendConfig = {
                type: 'postgres',
                url: 'postgresql://user:pass@localhost:5432/dexto',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
            });
            expect(result.database.type).toBe('postgres');
            if (result.database.type === 'postgres') {
                expect(result.database.url).toBe('postgresql://user:pass@localhost:5432/dexto');
            }
        });

        it('should accept PostgreSQL backend with connection string', () => {
            const config: PostgresBackendConfig = {
                type: 'postgres',
                connectionString: 'postgresql://user:pass@localhost:5432/dexto',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
            });
            expect(result.database.type).toBe('postgres');
            if (result.database.type === 'postgres') {
                expect(result.database.connectionString).toBe(
                    'postgresql://user:pass@localhost:5432/dexto'
                );
            }
        });

        it('should accept PostgreSQL backend with host/port details', () => {
            const config: PostgresBackendConfig = {
                type: 'postgres',
                host: 'localhost',
                port: 5432,
                database: 'dexto',
                password: 'secret',
            };

            const result = StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: config,
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
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
            expect(result.error?.issues[0]?.message).toContain(
                'PostgreSQL backend requires one of'
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
            expect(result.error?.issues[0]?.message).toContain('Invalid backend type');
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
            };

            const result = StorageSchema.safeParse(config);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.cache.type).toBe('redis');
                expect(result.data.database.type).toBe('postgres');
            }
        });

        it('should handle backend config type unions correctly', () => {
            const backends: BackendConfig[] = [
                { type: 'in-memory' },
                { type: 'redis', url: 'redis://localhost:6379' },
                { type: 'sqlite', path: '/tmp/test.db' },
                { type: 'postgres', url: 'postgresql://localhost/test' },
            ];

            backends.forEach((backend) => {
                const result = StorageSchema.parse({
                    cache: backend,
                    database: { type: 'in-memory' },
                });
                expect(result.cache.type).toBe(backend.type);
            });
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle typical development configuration', () => {
            const devConfig: StorageConfig = {
                cache: { type: 'in-memory' },
                database: { type: 'sqlite', path: './dev.db' },
            };

            const result = StorageSchema.safeParse(devConfig);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toEqual(devConfig);
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
            };

            const result = StorageSchema.safeParse(prodConfig);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toEqual(prodConfig);
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
            };

            const result = StorageSchema.safeParse(haConfig);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toEqual(haConfig);
            }
        });
    });
});
