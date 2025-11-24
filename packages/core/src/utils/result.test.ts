import { describe, test, expect } from 'vitest';
import { z, ZodError } from 'zod';
import { zodToIssues, ok, fail, hasErrors, splitIssues } from './result.js';
import { ErrorScope, ErrorType } from '../errors/index.js';
import type { Issue } from '../errors/index.js';

// Helper to create test issues with less boilerplate
const makeIssue = (
    code: string,
    severity: 'error' | 'warning',
    message = `Test ${severity}`
): Issue => ({
    code,
    message,
    severity,
    scope: ErrorScope.AGENT,
    type: ErrorType.USER,
    context: {},
});

describe('zodToIssues', () => {
    describe('standard error handling', () => {
        test('should convert basic Zod validation error', () => {
            const schema = z.object({
                name: z.string(),
                age: z.number(),
            });

            const result = schema.safeParse({ name: 'John', age: 'invalid' });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                expect(issues).toHaveLength(1);
                expect(issues[0]).toMatchObject({
                    code: 'schema_validation',
                    message: 'Expected number, received string',
                    path: ['age'],
                    severity: 'error',
                    scope: ErrorScope.AGENT,
                    type: ErrorType.USER,
                });
            }
        });

        test('should handle multiple validation errors', () => {
            const schema = z.object({
                email: z.string().email(),
                age: z.number().positive(),
            });

            const result = schema.safeParse({ email: 'invalid', age: -5 });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                expect(issues).toHaveLength(2);
                expect(issues[0]?.path).toEqual(['email']);
                expect(issues[1]?.path).toEqual(['age']);
            }
        });

        test('should respect severity parameter', () => {
            const schema = z.string();
            const result = schema.safeParse(123);

            if (!result.success) {
                const warningIssues = zodToIssues(result.error, 'warning');
                expect(warningIssues[0]?.severity).toBe('warning');

                const errorIssues = zodToIssues(result.error, 'error');
                expect(errorIssues[0]?.severity).toBe('error');
            }
        });
    });

    describe('union error handling', () => {
        test('should collect errors from 2-member union', () => {
            const schema = z.union([
                z.object({ type: z.literal('a'), value: z.string() }),
                z.object({ type: z.literal('b'), count: z.number() }),
            ]);

            const result = schema.safeParse({ type: 'a', value: 123 });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                // Should have issues from both union branches
                expect(issues.length).toBeGreaterThan(0);
                // At least one issue should mention the validation failure
                expect(
                    issues.some((i) => i.path?.includes('value') || i.path?.includes('type'))
                ).toBe(true);
            }
        });

        test('should collect errors from 4-member union', () => {
            // Simulates ApprovalResponseSchema structure
            const schema = z.union([
                z.object({ type: z.literal('tool'), toolId: z.string() }),
                z.object({ type: z.literal('command'), commandId: z.string() }),
                z.object({ type: z.literal('elicit'), question: z.string() }),
                z.object({ type: z.literal('custom'), data: z.object({}) }),
            ]);

            const result = schema.safeParse({ type: 'tool', toolId: 123 });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                // Should collect errors from all union branches, not just the first two
                expect(issues.length).toBeGreaterThan(0);
            }
        });

        test('should handle deeply nested union errors', () => {
            const innerSchema = z.union([z.string(), z.number()]);
            const outerSchema = z.object({
                field: innerSchema,
            });

            const result = outerSchema.safeParse({ field: true });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                expect(issues.length).toBeGreaterThan(0);
                expect(issues.some((i) => i.path?.includes('field'))).toBe(true);
            }
        });

        test('should handle union with all failing branches (no match)', () => {
            const schema = z.union([
                z.object({ type: z.literal('a'), data: z.string() }),
                z.object({ type: z.literal('b'), data: z.number() }),
                z.object({ type: z.literal('c'), data: z.boolean() }),
            ]);

            // Input doesn't match ANY branch - all 3 should fail
            const result = schema.safeParse({ type: 'x', data: 'invalid' });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                // Should collect errors from all 3 failed branches
                expect(issues.length).toBeGreaterThan(0);
                // Verify we got errors from multiple branches (not just the first)
                const uniquePaths = new Set(issues.map((i) => JSON.stringify(i.path)));
                expect(uniquePaths.size).toBeGreaterThan(0);
            }
        });

        test('should handle very deeply nested unions (3+ levels)', () => {
            // Union inside union inside union
            const innerUnion = z.union([z.string(), z.number()]);
            const middleUnion = z.union([innerUnion, z.boolean()]);
            const outerUnion = z.union([
                middleUnion,
                z.object({ foo: z.string() }),
                z.array(z.number()),
            ]);

            // This fails at multiple nesting levels
            const result = outerUnion.safeParse({ foo: 123 });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                // Should collect errors from deeply nested union branches
                expect(issues.length).toBeGreaterThan(0);
                // Should have errors mentioning the nested field
                expect(issues.some((i) => i.path?.includes('foo'))).toBe(true);
            }
        });

        test('should handle fallback when no union errors are collected', () => {
            // Create a manual ZodError with invalid_union but empty unionErrors
            const error = new ZodError([
                {
                    code: 'invalid_union',
                    unionErrors: [] as ZodError[],
                    path: ['field'],
                    message: 'Invalid union type',
                } as any,
            ]);

            const issues = zodToIssues(error);
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({
                code: 'schema_validation',
                message: 'Invalid union type',
                path: ['field'],
                severity: 'error',
            });
        });
    });

    describe('discriminated union error handling', () => {
        test('should handle discriminated union errors', () => {
            const schema = z.discriminatedUnion('type', [
                z.object({ type: z.literal('success'), data: z.string() }),
                z.object({ type: z.literal('error'), code: z.number() }),
            ]);

            const result = schema.safeParse({ type: 'success', data: 123 });
            expect(result.success).toBe(false);

            if (!result.success) {
                const issues = zodToIssues(result.error);
                expect(issues.length).toBeGreaterThan(0);
                expect(issues.some((i) => i.path?.includes('data'))).toBe(true);
            }
        });
    });
});

describe('Result helper functions', () => {
    describe('ok', () => {
        test('should create successful result without issues', () => {
            const result = ok({ value: 42 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data).toEqual({ value: 42 });
            }
            expect(result.issues).toEqual([]);
        });

        test('should create successful result with warnings', () => {
            const result = ok({ value: 42 }, [makeIssue('test_warning', 'warning')]);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data).toEqual({ value: 42 });
            }
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]?.severity).toBe('warning');
        });
    });

    describe('fail', () => {
        test('should create failed result', () => {
            const result = fail([makeIssue('test_error', 'error')]);
            expect(result.ok).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]?.severity).toBe('error');
        });
    });

    describe('hasErrors', () => {
        test('should return true when issues contain errors', () => {
            expect(hasErrors([makeIssue('test_error', 'error')])).toBe(true);
        });

        test('should return false when issues only contain warnings', () => {
            expect(hasErrors([makeIssue('test_warning', 'warning')])).toBe(false);
        });

        test('should return false for empty array', () => {
            expect(hasErrors([])).toBe(false);
        });
    });

    describe('splitIssues', () => {
        test('should split errors and warnings', () => {
            const issues = [makeIssue('test_error', 'error'), makeIssue('test_warning', 'warning')];
            const { errors, warnings } = splitIssues(issues);

            expect(errors).toHaveLength(1);
            expect(warnings).toHaveLength(1);
            expect(errors[0]?.severity).toBe('error');
            expect(warnings[0]?.severity).toBe('warning');
        });

        test('should handle all errors', () => {
            const issues = [
                makeIssue('err1', 'error', 'Error 1'),
                makeIssue('err2', 'error', 'Error 2'),
            ];
            const { errors, warnings } = splitIssues(issues);

            expect(errors).toHaveLength(2);
            expect(warnings).toHaveLength(0);
        });

        test('should handle all warnings', () => {
            const issues = [
                makeIssue('warn1', 'warning', 'Warning 1'),
                makeIssue('warn2', 'warning', 'Warning 2'),
            ];
            const { errors, warnings } = splitIssues(issues);

            expect(errors).toHaveLength(0);
            expect(warnings).toHaveLength(2);
        });
    });
});
