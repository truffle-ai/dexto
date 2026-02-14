import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    StorageSchema,
    RedisCacheSchema,
    InMemoryCacheSchema,
    PostgresDatabaseSchema,
} from './schemas.js';

const testBlobConfig = { type: 'local' as const, storePath: '/tmp/test-blobs' };

describe('StorageSchema', () => {
    it('accepts built-in backend configs (validation happens in factories)', () => {
        const result = StorageSchema.safeParse({
            cache: { type: 'redis', url: 'redis://localhost:6379' },
            database: { type: 'postgres', url: 'postgresql://localhost/test' },
            blob: testBlobConfig,
        });
        expect(result.success).toBe(true);
    });

    it('accepts custom backend types with arbitrary fields', () => {
        const result = StorageSchema.safeParse({
            cache: { type: 'memcached', servers: ['127.0.0.1:11211'] },
            database: { type: 'dynamo', table: 'agent-data' },
            blob: { type: 's3', bucket: 'my-bucket' },
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing required backend discriminator', () => {
        const result = StorageSchema.safeParse({
            cache: {},
            database: { type: 'in-memory' },
            blob: testBlobConfig,
        });
        expect(result.success).toBe(false);
        expect(result.error?.issues.some((issue) => issue.path.join('.') === 'cache.type')).toBe(
            true
        );
    });

    it('rejects extra top-level fields', () => {
        const result = StorageSchema.safeParse({
            cache: { type: 'in-memory' },
            database: { type: 'in-memory' },
            blob: testBlobConfig,
            extra: true,
        });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
    });
});

describe('Built-in backend schemas', () => {
    it('RedisCacheSchema requires url or host', () => {
        const result = RedisCacheSchema.safeParse({ type: 'redis' });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
    });

    it('PostgresDatabaseSchema requires connection info', () => {
        const result = PostgresDatabaseSchema.safeParse({ type: 'postgres' });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
    });

    it('InMemoryCacheSchema validates positive maxConnections', () => {
        const result = InMemoryCacheSchema.safeParse({ type: 'in-memory', maxConnections: 0 });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
    });
});
