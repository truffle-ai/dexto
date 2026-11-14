import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    PERMISSIONS_MODE_LABELS,
    PermissionsConfigSchema,
    getDeprecatedPermissionsModeWarning,
    ToolPoliciesSchema,
    type PermissionsConfig,
    type ToolPolicies,
    type ValidatedPermissionsConfig,
} from './schemas.js';

describe('PermissionsConfigSchema', () => {
    it('accepts the full-access and asks-you modes', () => {
        for (const mode of ['full-access', 'asks-you'] as const) {
            expect(PermissionsConfigSchema.parse({ mode }).mode).toBe(mode);
            expect(getDeprecatedPermissionsModeWarning(mode)).toBeNull();
        }
        expect(PERMISSIONS_MODE_LABELS).toEqual({
            'full-access': 'Full access',
            'asks-you': 'Asks you',
        });

        const invalidResult = PermissionsConfigSchema.safeParse({ mode: 'blocked' });
        expect(invalidResult.success).toBe(false);
        expect(invalidResult.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_value);
        expect(invalidResult.error?.issues[0]?.path).toEqual(['mode']);
    });

    it('validates approval timeout as a positive integer when present', () => {
        for (const timeout of [-1, 0]) {
            const result = PermissionsConfigSchema.safeParse({ timeout });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
            expect(result.error?.issues[0]?.path).toEqual(['timeout']);
        }

        const floatResult = PermissionsConfigSchema.safeParse({ timeout: 1.5 });
        expect(floatResult.success).toBe(false);
        expect(floatResult.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);

        expect(PermissionsConfigSchema.parse({ timeout: 1000 }).timeout).toBe(1000);
        expect(PermissionsConfigSchema.parse({}).timeout).toBeUndefined();
    });

    it.each([
        ['manual', 'asks-you', 'Asks you'],
        ['auto-approve', 'full-access', 'Full access'],
    ] as const)(
        'maps the deprecated %s mode to %s with a warning naming the new value',
        (legacy, replacement, label) => {
            expect(PermissionsConfigSchema.parse({ mode: legacy }).mode).toBe(replacement);
            expect(getDeprecatedPermissionsModeWarning(legacy)).toBe(
                `Permissions mode "${legacy}" is deprecated; use "${replacement}" (${label}) instead. "${legacy}" will stop working in the next release.`
            );
        }
    );

    it('does not warn for missing or unknown values', () => {
        expect(getDeprecatedPermissionsModeWarning(undefined)).toBeNull();
        expect(getDeprecatedPermissionsModeWarning('toString')).toBeNull();
        expect(PermissionsConfigSchema.safeParse({ mode: 'toString' }).success).toBe(false);
    });

    it('defaults to full-access with persistent remembered approvals and an empty allow list', () => {
        expect(PermissionsConfigSchema.parse({})).toEqual({
            mode: 'full-access',
            allowedToolsStorage: 'storage',
            toolPolicies: {
                alwaysAllow: [],
            },
        });
    });

    it('accepts asks-you configuration with allow-list policies', () => {
        const config = {
            mode: 'asks-you' as const,
            timeout: 30000,
            allowedToolsStorage: 'memory' as const,
            toolPolicies: {
                alwaysAllow: ['ask_user', 'mcp--filesystem--read_file'],
            },
        };

        expect(PermissionsConfigSchema.parse(config)).toEqual(config);
    });

    it('rejects unknown permission policy fields', () => {
        const result = PermissionsConfigSchema.safeParse({
            toolPolicies: {
                alwaysAllow: [],
                blockedTools: ['mcp--filesystem--delete_file'],
            },
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        expect(result.error?.issues[0]?.path).toEqual(['toolPolicies']);
    });

    it('keeps the exported input and output types aligned with the schema', () => {
        const input: PermissionsConfig = { mode: 'asks-you' };
        const result: ValidatedPermissionsConfig = PermissionsConfigSchema.parse(input);

        expect(result.mode).toBe('asks-you');
        expect(result.allowedToolsStorage).toBe('storage');
        expect(result.toolPolicies.alwaysAllow).toEqual([]);
    });
});

describe('ToolPoliciesSchema', () => {
    it('accepts an allow-list policy and defaults to an empty allow list', () => {
        expect(ToolPoliciesSchema.parse(undefined)).toEqual({ alwaysAllow: [] });
        expect(ToolPoliciesSchema.parse({})).toEqual({ alwaysAllow: [] });

        const result: ToolPolicies = ToolPoliciesSchema.parse({
            alwaysAllow: ['ask_user', 'mcp--filesystem--read_file'],
        });
        expect(result.alwaysAllow).toEqual(['ask_user', 'mcp--filesystem--read_file']);
    });

    it('rejects non-array allow-list values', () => {
        const result = ToolPoliciesSchema.safeParse({ alwaysAllow: 'not-an-array' });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
        expect(result.error?.issues[0]?.path).toEqual(['alwaysAllow']);
    });

    it('rejects non-string allow-list entries', () => {
        const result = ToolPoliciesSchema.safeParse({ alwaysAllow: [123] });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
    });

    it('rejects unknown fields instead of silently preserving unsupported policy', () => {
        const result = ToolPoliciesSchema.safeParse({
            alwaysAllow: ['ask_user'],
            blockedTools: ['mcp--filesystem--delete_file'],
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        expect(result.error?.issues[0]?.path).toEqual([]);
    });
});
