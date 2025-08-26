import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SessionConfigSchema, type SessionConfig, type ValidatedSessionConfig } from './schemas.js';

describe('SessionConfigSchema', () => {
    describe('Field Validation', () => {
        it('should validate maxSessions as positive integer', () => {
            // Negative should fail
            let result = SessionConfigSchema.safeParse({ maxSessions: -1 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['maxSessions']);

            // Zero should fail
            result = SessionConfigSchema.safeParse({ maxSessions: 0 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['maxSessions']);

            // Float should fail
            result = SessionConfigSchema.safeParse({ maxSessions: 1.5 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['maxSessions']);

            // Valid values should pass
            const valid1 = SessionConfigSchema.parse({ maxSessions: 1 });
            expect(valid1.maxSessions).toBe(1);

            const valid2 = SessionConfigSchema.parse({ maxSessions: 100 });
            expect(valid2.maxSessions).toBe(100);
        });

        it('should validate sessionTTL as positive integer', () => {
            // Negative should fail
            let result = SessionConfigSchema.safeParse({ sessionTTL: -1 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['sessionTTL']);

            // Zero should fail
            result = SessionConfigSchema.safeParse({ sessionTTL: 0 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['sessionTTL']);

            // Float should fail
            result = SessionConfigSchema.safeParse({ sessionTTL: 1.5 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['sessionTTL']);

            // Valid values should pass
            const valid1 = SessionConfigSchema.parse({ sessionTTL: 1000 });
            expect(valid1.sessionTTL).toBe(1000);

            const valid2 = SessionConfigSchema.parse({ sessionTTL: 3600000 });
            expect(valid2.sessionTTL).toBe(3600000);
        });

        it('should reject string inputs without coercion', () => {
            const result = SessionConfigSchema.safeParse({
                maxSessions: '50',
                sessionTTL: '1800000',
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['maxSessions']);
        });
    });

    describe('Default Values', () => {
        it('should apply field defaults for empty object', () => {
            const result = SessionConfigSchema.parse({});

            expect(result).toEqual({
                maxSessions: 100,
                sessionTTL: 3600000,
            });
        });

        it('should apply field defaults for partial config', () => {
            const result1 = SessionConfigSchema.parse({ maxSessions: 50 });
            expect(result1).toEqual({
                maxSessions: 50,
                sessionTTL: 3600000,
            });

            const result2 = SessionConfigSchema.parse({ sessionTTL: 1800000 });
            expect(result2).toEqual({
                maxSessions: 100,
                sessionTTL: 1800000,
            });
        });

        it('should override defaults when values provided', () => {
            const config = {
                maxSessions: 200,
                sessionTTL: 7200000,
            };

            const result = SessionConfigSchema.parse(config);
            expect(result).toEqual(config);
        });
    });

    describe('Edge Cases', () => {
        it('should handle boundary values', () => {
            // Very small valid values
            const small = SessionConfigSchema.parse({
                maxSessions: 1,
                sessionTTL: 1,
            });
            expect(small.maxSessions).toBe(1);
            expect(small.sessionTTL).toBe(1);

            // Large values
            const large = SessionConfigSchema.parse({
                maxSessions: 10000,
                sessionTTL: 86400000, // 24 hours
            });
            expect(large.maxSessions).toBe(10000);
            expect(large.sessionTTL).toBe(86400000);
        });

        it('should reject non-numeric types', () => {
            // String should fail
            let result = SessionConfigSchema.safeParse({ maxSessions: 'abc' });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['maxSessions']);

            // Null should fail
            result = SessionConfigSchema.safeParse({ sessionTTL: null });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['sessionTTL']);

            // Object should fail
            result = SessionConfigSchema.safeParse({ maxSessions: {} });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['maxSessions']);
        });

        it('should reject extra fields with strict validation', () => {
            const configWithExtra = {
                maxSessions: 100,
                sessionTTL: 3600000,
                unknownField: 'should fail',
            };

            const result = SessionConfigSchema.safeParse(configWithExtra);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should have correct input and output types', () => {
            // Input type allows optional fields (due to defaults)
            const input: SessionConfig = {};
            const inputPartial: SessionConfig = { maxSessions: 50 };
            const inputFull: SessionConfig = { maxSessions: 100, sessionTTL: 3600000 };

            // All should be valid inputs
            expect(() => SessionConfigSchema.parse(input)).not.toThrow();
            expect(() => SessionConfigSchema.parse(inputPartial)).not.toThrow();
            expect(() => SessionConfigSchema.parse(inputFull)).not.toThrow();
        });

        it('should produce validated output type', () => {
            const result: ValidatedSessionConfig = SessionConfigSchema.parse({});

            // Output type guarantees all fields are present
            expect(typeof result.maxSessions).toBe('number');
            expect(typeof result.sessionTTL).toBe('number');
            expect(result.maxSessions).toBeGreaterThan(0);
            expect(result.sessionTTL).toBeGreaterThan(0);
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle typical production config', () => {
            const prodConfig = {
                maxSessions: 1000,
                sessionTTL: 7200000, // 2 hours
            };

            const result = SessionConfigSchema.parse(prodConfig);
            expect(result).toEqual(prodConfig);
        });

        it('should handle development config with shorter TTL', () => {
            const devConfig = {
                maxSessions: 10,
                sessionTTL: 300000, // 5 minutes
            };

            const result = SessionConfigSchema.parse(devConfig);
            expect(result).toEqual(devConfig);
        });
    });
});
