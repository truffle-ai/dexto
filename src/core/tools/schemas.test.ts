import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    InternalToolsSchema,
    ToolConfirmationConfigSchema,
    type InternalToolsConfig,
    type ToolConfirmationConfig,
    type ValidatedToolConfirmationConfig,
} from './schemas.js';

// safeParse for invalid test cases to check exact error codes
// parse for valid test cases for less boilerplate
describe('InternalToolsSchema', () => {
    describe('Array Validation', () => {
        it('should accept empty array as default', () => {
            const result = InternalToolsSchema.parse([]);
            expect(result).toEqual([]);
        });

        it('should accept valid internal tool names', () => {
            const result = InternalToolsSchema.parse(['search_history']);
            expect(result).toEqual(['search_history']);
        });

        it('should reject invalid tool names', () => {
            const result = InternalToolsSchema.safeParse(['invalid-tool']);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
            expect(result.error?.issues[0]?.path).toEqual([0]);
        });
        // TODO: update when more valid tools are added
        it('should accept multiple valid tools', () => {
            const result = InternalToolsSchema.parse(['search_history']);
            expect(result).toHaveLength(1);
        });
    });

    describe('Default Values', () => {
        it('should apply default empty array when undefined', () => {
            const result = InternalToolsSchema.parse(undefined);
            expect(result).toEqual([]);
        });
    });

    describe('Type Safety', () => {
        it('should have correct type inference', () => {
            const result: InternalToolsConfig = InternalToolsSchema.parse([]);
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

describe('ToolConfirmationConfigSchema', () => {
    describe('Field Validation', () => {
        it('should validate mode enum values', () => {
            const validModes = ['event-based', 'auto-approve', 'auto-deny'];

            validModes.forEach((mode) => {
                const result = ToolConfirmationConfigSchema.parse({ mode });
                expect(result.mode).toBe(mode);
            });

            const invalidResult = ToolConfirmationConfigSchema.safeParse({ mode: 'invalid' });
            expect(invalidResult.success).toBe(false);
            expect(invalidResult.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
            expect(invalidResult.error?.issues[0]?.path).toEqual(['mode']);
        });

        it('should validate timeout as positive integer', () => {
            // Negative should fail
            let result = ToolConfirmationConfigSchema.safeParse({ timeout: -1 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['timeout']);

            // Zero should fail
            result = ToolConfirmationConfigSchema.safeParse({ timeout: 0 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['timeout']);

            // Float should fail
            result = ToolConfirmationConfigSchema.safeParse({ timeout: 1.5 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['timeout']);

            // Valid values should pass
            const valid1 = ToolConfirmationConfigSchema.parse({ timeout: 1000 });
            expect(valid1.timeout).toBe(1000);

            const valid2 = ToolConfirmationConfigSchema.parse({ timeout: 30000 });
            expect(valid2.timeout).toBe(30000);
        });

        it('should validate allowedToolsStorage enum values', () => {
            const validStorage = ['memory', 'storage'];

            validStorage.forEach((allowedToolsStorage) => {
                const result = ToolConfirmationConfigSchema.parse({ allowedToolsStorage });
                expect(result.allowedToolsStorage).toBe(allowedToolsStorage);
            });

            const invalidResult = ToolConfirmationConfigSchema.safeParse({
                allowedToolsStorage: 'invalid',
            });
            expect(invalidResult.success).toBe(false);
            expect(invalidResult.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
            expect(invalidResult.error?.issues[0]?.path).toEqual(['allowedToolsStorage']);
        });
    });

    describe('Default Values', () => {
        it('should apply all field defaults for empty object', () => {
            const result = ToolConfirmationConfigSchema.parse({});

            expect(result).toEqual({
                mode: 'event-based',
                timeout: 30000,
                allowedToolsStorage: 'storage',
            });
        });

        it('should apply field defaults for partial config', () => {
            const result1 = ToolConfirmationConfigSchema.parse({ mode: 'auto-approve' });
            expect(result1).toEqual({
                mode: 'auto-approve',
                timeout: 30000,
                allowedToolsStorage: 'storage',
            });

            const result2 = ToolConfirmationConfigSchema.parse({ timeout: 15000 });
            expect(result2).toEqual({
                mode: 'event-based',
                timeout: 15000,
                allowedToolsStorage: 'storage',
            });

            const result3 = ToolConfirmationConfigSchema.parse({ allowedToolsStorage: 'memory' });
            expect(result3).toEqual({
                mode: 'event-based',
                timeout: 30000,
                allowedToolsStorage: 'memory',
            });
        });

        it('should override defaults when values provided', () => {
            const config = {
                mode: 'auto-deny' as const,
                timeout: 60000,
                allowedToolsStorage: 'memory' as const,
            };

            const result = ToolConfirmationConfigSchema.parse(config);
            expect(result).toEqual(config);
        });
    });

    describe('Edge Cases', () => {
        it('should handle boundary timeout values', () => {
            // Very small valid value
            const small = ToolConfirmationConfigSchema.parse({ timeout: 1 });
            expect(small.timeout).toBe(1);

            // Large timeout value
            const large = ToolConfirmationConfigSchema.parse({ timeout: 300000 }); // 5 minutes
            expect(large.timeout).toBe(300000);
        });

        it('should reject non-string mode values', () => {
            // Number should fail
            let result = ToolConfirmationConfigSchema.safeParse({ mode: 123 });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['mode']);

            // Null should fail
            result = ToolConfirmationConfigSchema.safeParse({ mode: null });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['mode']);
        });

        it('should reject non-numeric timeout values', () => {
            // String should fail
            let result = ToolConfirmationConfigSchema.safeParse({ timeout: 'abc' });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['timeout']);

            // Null should fail
            result = ToolConfirmationConfigSchema.safeParse({ timeout: null });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['timeout']);
        });

        it('should reject extra fields with strict validation', () => {
            const configWithExtra = {
                mode: 'event-based',
                timeout: 30000,
                allowedToolsStorage: 'storage',
                unknownField: 'should fail',
            };

            const result = ToolConfirmationConfigSchema.safeParse(configWithExtra);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should have correct input and output types', () => {
            // Input type allows optional fields (due to defaults)
            const input: ToolConfirmationConfig = {};
            const inputPartial: ToolConfirmationConfig = { mode: 'auto-approve' };
            const inputFull: ToolConfirmationConfig = {
                mode: 'event-based',
                timeout: 30000,
                allowedToolsStorage: 'storage',
            };

            expect(() => ToolConfirmationConfigSchema.parse(input)).not.toThrow();
            expect(() => ToolConfirmationConfigSchema.parse(inputPartial)).not.toThrow();
            expect(() => ToolConfirmationConfigSchema.parse(inputFull)).not.toThrow();
        });

        it('should produce validated output type', () => {
            const result: ValidatedToolConfirmationConfig = ToolConfirmationConfigSchema.parse({});

            // Output type guarantees all fields are present
            expect(typeof result.mode).toBe('string');
            expect(typeof result.timeout).toBe('number');
            expect(typeof result.allowedToolsStorage).toBe('string');
            expect(result.timeout).toBeGreaterThan(0);
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle interactive mode configuration', () => {
            const interactiveConfig = {
                mode: 'event-based' as const,
                timeout: 30000,
                allowedToolsStorage: 'storage' as const,
            };

            const result = ToolConfirmationConfigSchema.parse(interactiveConfig);
            expect(result).toEqual(interactiveConfig);
        });

        it('should handle auto-approve configuration', () => {
            const autoApproveConfig = {
                mode: 'auto-approve' as const,
                timeout: 1000, // Lower timeout since no user interaction
                allowedToolsStorage: 'memory' as const, // Memory for development
            };

            const result = ToolConfirmationConfigSchema.parse(autoApproveConfig);
            expect(result).toEqual(autoApproveConfig);
        });

        it('should handle strict security configuration', () => {
            const strictConfig = {
                mode: 'auto-deny' as const,
                timeout: 5000, // Short timeout
                allowedToolsStorage: 'memory' as const, // No persistent approvals
            };

            const result = ToolConfirmationConfigSchema.parse(strictConfig);
            expect(result).toEqual(strictConfig);
        });
    });
});
