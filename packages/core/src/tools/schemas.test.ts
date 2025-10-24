import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    InternalToolsSchema,
    ToolConfirmationConfigSchema,
    ToolPoliciesSchema,
    type InternalToolsConfig,
    type ToolConfirmationConfig,
    type ValidatedToolConfirmationConfig,
    type ToolPolicies,
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

            const valid2 = ToolConfirmationConfigSchema.parse({ timeout: 120000 });
            expect(valid2.timeout).toBe(120000);
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
                timeout: 120000,
                allowedToolsStorage: 'storage',
            });
        });

        it('should apply field defaults for partial config', () => {
            const result1 = ToolConfirmationConfigSchema.parse({ mode: 'auto-approve' });
            expect(result1).toEqual({
                mode: 'auto-approve',
                timeout: 120000,
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
                timeout: 120000,
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

        it('should handle configuration with tool policies', () => {
            const configWithPolicies = {
                mode: 'event-based' as const,
                timeout: 30000,
                allowedToolsStorage: 'storage' as const,
                toolPolicies: {
                    alwaysAllow: ['internal--ask_user', 'mcp--filesystem--read_file'],
                    alwaysDeny: ['mcp--filesystem--delete_file'],
                },
            };

            const result = ToolConfirmationConfigSchema.parse(configWithPolicies);
            expect(result).toEqual(configWithPolicies);
            expect(result.toolPolicies?.alwaysAllow).toHaveLength(2);
            expect(result.toolPolicies?.alwaysDeny).toHaveLength(1);
        });
    });
});

describe('ToolPoliciesSchema', () => {
    describe('Field Validation', () => {
        it('should accept empty arrays for both fields', () => {
            const result = ToolPoliciesSchema.parse({
                alwaysAllow: [],
                alwaysDeny: [],
            });
            expect(result).toEqual({
                alwaysAllow: [],
                alwaysDeny: [],
            });
        });

        it('should accept valid tool names in alwaysAllow', () => {
            const result = ToolPoliciesSchema.parse({
                alwaysAllow: ['internal--ask_user', 'mcp--filesystem--read_file'],
                alwaysDeny: [],
            });
            expect(result.alwaysAllow).toEqual([
                'internal--ask_user',
                'mcp--filesystem--read_file',
            ]);
        });

        it('should accept valid tool names in alwaysDeny', () => {
            const result = ToolPoliciesSchema.parse({
                alwaysAllow: [],
                alwaysDeny: ['mcp--filesystem--delete_file', 'mcp--playwright--execute_script'],
            });
            expect(result.alwaysDeny).toEqual([
                'mcp--filesystem--delete_file',
                'mcp--playwright--execute_script',
            ]);
        });

        it('should accept both lists populated', () => {
            const result = ToolPoliciesSchema.parse({
                alwaysAllow: ['internal--ask_user'],
                alwaysDeny: ['mcp--filesystem--delete_file'],
            });
            expect(result.alwaysAllow).toHaveLength(1);
            expect(result.alwaysDeny).toHaveLength(1);
        });

        it('should reject non-array values for alwaysAllow', () => {
            const result = ToolPoliciesSchema.safeParse({
                alwaysAllow: 'not-an-array',
                alwaysDeny: [],
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['alwaysAllow']);
        });

        it('should reject non-array values for alwaysDeny', () => {
            const result = ToolPoliciesSchema.safeParse({
                alwaysAllow: [],
                alwaysDeny: 'not-an-array',
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
            expect(result.error?.issues[0]?.path).toEqual(['alwaysDeny']);
        });

        it('should reject non-string elements in arrays', () => {
            const result = ToolPoliciesSchema.safeParse({
                alwaysAllow: [123, 456],
                alwaysDeny: [],
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
        });
    });

    describe('Default Values', () => {
        it('should apply default empty arrays when undefined', () => {
            const result = ToolPoliciesSchema.parse(undefined);
            expect(result).toEqual({
                alwaysAllow: [],
                alwaysDeny: [],
            });
        });

        it('should apply defaults for missing fields', () => {
            const result = ToolPoliciesSchema.parse({});
            expect(result).toEqual({
                alwaysAllow: [],
                alwaysDeny: [],
            });
        });
    });

    describe('Edge Cases', () => {
        it('should allow duplicate tool names in the same list', () => {
            // Schema doesn't enforce uniqueness - that's application logic
            const result = ToolPoliciesSchema.parse({
                alwaysAllow: ['tool1', 'tool1'],
                alwaysDeny: [],
            });
            expect(result.alwaysAllow).toEqual(['tool1', 'tool1']);
        });

        it('should allow same tool name in both lists', () => {
            // Schema validation allows this - precedence is handled by application logic
            const result = ToolPoliciesSchema.parse({
                alwaysAllow: ['tool1'],
                alwaysDeny: ['tool1'],
            });
            expect(result.alwaysAllow).toContain('tool1');
            expect(result.alwaysDeny).toContain('tool1');
        });

        it('should reject extra fields with strict validation', () => {
            const policiesWithExtra = {
                alwaysAllow: [],
                alwaysDeny: [],
                extraField: 'should fail',
            };

            const result = ToolPoliciesSchema.safeParse(policiesWithExtra);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should have correct type inference', () => {
            const result: ToolPolicies = ToolPoliciesSchema.parse({
                alwaysAllow: ['tool1'],
                alwaysDeny: ['tool2'],
            });
            expect(Array.isArray(result.alwaysAllow)).toBe(true);
            expect(Array.isArray(result.alwaysDeny)).toBe(true);
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle safe development configuration', () => {
            const devPolicies = {
                alwaysAllow: [
                    'internal--ask_user',
                    'mcp--filesystem--read_file',
                    'mcp--filesystem--list_directory',
                ],
                alwaysDeny: ['mcp--filesystem--write_file', 'mcp--filesystem--delete_file'],
            };

            const result = ToolPoliciesSchema.parse(devPolicies);
            expect(result).toEqual(devPolicies);
        });

        it('should handle production security configuration', () => {
            const prodPolicies = {
                alwaysAllow: ['internal--ask_user'],
                alwaysDeny: [
                    'mcp--filesystem--delete_file',
                    'mcp--playwright--execute_script',
                    'mcp--shell--execute',
                ],
            };

            const result = ToolPoliciesSchema.parse(prodPolicies);
            expect(result).toEqual(prodPolicies);
        });

        it('should handle minimal allow-only policy', () => {
            const allowOnlyPolicy = {
                alwaysAllow: ['internal--ask_user', 'mcp--filesystem--read_file'],
                alwaysDeny: [],
            };

            const result = ToolPoliciesSchema.parse(allowOnlyPolicy);
            expect(result.alwaysAllow).toHaveLength(2);
            expect(result.alwaysDeny).toHaveLength(0);
        });

        it('should handle strict deny-only policy', () => {
            const denyOnlyPolicy = {
                alwaysAllow: [],
                alwaysDeny: ['mcp--filesystem--delete_file', 'mcp--shell--execute'],
            };

            const result = ToolPoliciesSchema.parse(denyOnlyPolicy);
            expect(result.alwaysAllow).toHaveLength(0);
            expect(result.alwaysDeny).toHaveLength(2);
        });
    });
});
