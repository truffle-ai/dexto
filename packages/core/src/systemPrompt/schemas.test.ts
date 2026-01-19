import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    SystemPromptConfigSchema,
    type SystemPromptConfig,
    type ValidatedSystemPromptConfig,
} from './schemas.js';

describe('SystemPromptConfigSchema', () => {
    describe('String Input Transform', () => {
        it('should transform string to contributors object', () => {
            const result = SystemPromptConfigSchema.parse('You are a helpful assistant');

            expect(result.contributors).toHaveLength(1);
            const contributor = result.contributors[0];
            expect(contributor).toEqual({
                id: 'inline',
                type: 'static',
                content: 'You are a helpful assistant',
                priority: 0,
                enabled: true,
            });
        });

        it('should handle empty string', () => {
            const result = SystemPromptConfigSchema.parse('');

            expect(result.contributors).toHaveLength(1);
            const contributor = result.contributors[0];
            if (contributor?.type === 'static') {
                expect(contributor.content).toBe('');
            }
        });

        it('should handle multiline string', () => {
            const multilinePrompt = `You are Dexto, an AI assistant.

You can help with:
- Coding tasks
- Analysis
- General questions`;

            const result = SystemPromptConfigSchema.parse(multilinePrompt);

            expect(result.contributors).toHaveLength(1);
            const contributor = result.contributors[0];
            if (contributor?.type === 'static') {
                expect((contributor! as any).content).toBe(multilinePrompt);
            }
        });
    });

    describe('Object Input Validation', () => {
        it('should apply default contributors for empty object', () => {
            const result = SystemPromptConfigSchema.parse({});

            expect(result.contributors).toHaveLength(3);
            expect(result.contributors[0]).toEqual({
                id: 'date',
                type: 'dynamic',
                priority: 10,
                source: 'date',
                enabled: true,
            });
            expect(result.contributors[1]).toEqual({
                id: 'env',
                type: 'dynamic',
                priority: 15,
                source: 'env',
                enabled: true,
            });
            expect(result.contributors[2]).toEqual({
                id: 'resources',
                type: 'dynamic',
                priority: 20,
                source: 'resources',
                enabled: false,
            });
        });

        it('should allow overriding default contributors', () => {
            const result = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'custom',
                        type: 'static',
                        priority: 0,
                        content: 'Custom prompt',
                        enabled: true,
                    },
                ],
            });

            expect(result.contributors).toHaveLength(1);
            expect(result.contributors[0]?.id).toBe('custom');
        });

        it('should pass through valid contributors object', () => {
            const contributorsConfig = {
                contributors: [
                    {
                        id: 'main',
                        type: 'static' as const,
                        priority: 0,
                        content: 'You are Dexto',
                        enabled: true,
                    },
                    {
                        id: 'date',
                        type: 'dynamic' as const,
                        priority: 10,
                        source: 'date',
                        enabled: true,
                    },
                ],
            };

            const result = SystemPromptConfigSchema.parse(contributorsConfig);
            expect(result).toEqual(contributorsConfig);
        });
    });

    describe('Contributor Type Validation', () => {
        it('should validate static contributors', () => {
            const validStatic = {
                contributors: [{ id: 'test', type: 'static', priority: 0, content: 'hello world' }],
            };
            const validResult = SystemPromptConfigSchema.parse(validStatic);
            expect(validResult.contributors[0]?.type).toBe('static');

            const invalidStatic = {
                contributors: [
                    { id: 'test', type: 'static', priority: 0 }, // Missing content
                ],
            };
            const result = SystemPromptConfigSchema.safeParse(invalidStatic);
            expect(result.success).toBe(false);
            // For union schemas, the actual error is in unionErrors[1] (second branch - the object branch)
            // TODO: Fix typing - unionErrors not properly typed in Zod
            const unionError = result.error?.issues[0] as any;
            expect(unionError?.code).toBe('invalid_union');
            const objectErrors = unionError?.unionErrors?.[1]?.issues;
            expect(objectErrors?.[0]?.path).toEqual(['contributors', 0, 'content']);
            expect(objectErrors?.[0]?.code).toBe('invalid_type');
        });

        it('should validate dynamic contributors', () => {
            const validDynamic = {
                contributors: [{ id: 'date', type: 'dynamic', priority: 10, source: 'date' }],
            };
            const validResult = SystemPromptConfigSchema.parse(validDynamic);
            expect(validResult.contributors[0]?.type).toBe('dynamic');

            const invalidDynamic = {
                contributors: [
                    { id: 'date', type: 'dynamic', priority: 10 }, // Missing source
                ],
            };
            const result = SystemPromptConfigSchema.safeParse(invalidDynamic);
            expect(result.success).toBe(false);
            // For union schemas, the actual error is in unionErrors[1] (second branch - the object branch)
            // TODO: Fix typing - unionErrors not properly typed in Zod
            const unionError = result.error?.issues[0] as any;
            expect(unionError?.code).toBe('invalid_union');
            const objectErrors = unionError?.unionErrors?.[1]?.issues;
            expect(objectErrors?.[0]?.path).toEqual(['contributors', 0, 'source']);
            expect(objectErrors?.[0]?.code).toBe('invalid_type');
        });

        it('should validate dynamic contributor source enum', () => {
            const validSources = ['date', 'env', 'resources'];

            for (const source of validSources) {
                const validConfig = {
                    contributors: [{ id: 'test', type: 'dynamic', priority: 10, source }],
                };
                const result = SystemPromptConfigSchema.parse(validConfig);
                expect(result.contributors[0]?.type).toBe('dynamic');
            }

            const invalidSource = {
                contributors: [
                    { id: 'test', type: 'dynamic', priority: 10, source: 'invalidSource' }, // Invalid enum value
                ],
            };
            const result = SystemPromptConfigSchema.safeParse(invalidSource);
            expect(result.success).toBe(false);
            // For union schemas, the actual error is in unionErrors[1] (second branch - the object branch)
            // TODO: Fix typing - unionErrors not properly typed in Zod
            const unionError = result.error?.issues[0] as any;
            expect(unionError?.code).toBe('invalid_union');
            const objectErrors = unionError?.unionErrors?.[1]?.issues;
            expect(objectErrors?.[0]?.path).toEqual(['contributors', 0, 'source']);
            expect(objectErrors?.[0]?.code).toBe('invalid_enum_value');
        });

        it('should validate file contributors', () => {
            const validFile = {
                contributors: [
                    {
                        id: 'docs',
                        type: 'file',
                        priority: 5,
                        files: [path.join(process.cwd(), 'README.md')],
                    },
                ],
            };
            const validResult = SystemPromptConfigSchema.parse(validFile);
            expect(validResult.contributors[0]?.type).toBe('file');

            const invalidFile = {
                contributors: [
                    { id: 'docs', type: 'file', priority: 5, files: [] }, // Empty files array
                ],
            };
            const result = SystemPromptConfigSchema.safeParse(invalidFile);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['contributors', 0, 'files']);

            const relativePathFile = {
                contributors: [
                    { id: 'docs', type: 'file', priority: 5, files: ['relative/path.md'] },
                ],
            };
            const relativeResult = SystemPromptConfigSchema.safeParse(relativePathFile);
            expect(relativeResult.success).toBe(false);
        });

        it('should reject invalid contributor types', () => {
            const result = SystemPromptConfigSchema.safeParse({
                contributors: [
                    { id: 'invalid', type: 'invalid', priority: 0 }, // Invalid type
                ],
            });
            expect(result.success).toBe(false);
            // For union schemas, the actual error is in unionErrors[1] (second branch - the object branch)
            // TODO: Fix typing - unionErrors not properly typed in Zod
            const unionError = result.error?.issues[0] as any;
            expect(unionError?.code).toBe('invalid_union');
            const objectErrors = unionError?.unionErrors?.[1]?.issues;
            expect(objectErrors?.[0]?.path).toEqual(['contributors', 0, 'type']);
            expect(objectErrors?.[0]?.code).toBe('invalid_union_discriminator');
        });

        it('should reject extra fields with strict validation', () => {
            const result = SystemPromptConfigSchema.safeParse({
                contributors: [{ id: 'test', type: 'static', priority: 0, content: 'test' }],
                unknownField: 'should fail',
            });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
        });
    });

    describe('Type Safety', () => {
        it('should handle input and output types correctly', () => {
            // Input can be string or object
            const stringInput: SystemPromptConfig = 'Hello world';
            const objectInput: SystemPromptConfig = {
                contributors: [{ id: 'test', type: 'static', priority: 0, content: 'test' }],
            };

            const stringResult = SystemPromptConfigSchema.parse(stringInput);
            const objectResult = SystemPromptConfigSchema.parse(objectInput);

            // Both should produce ValidatedSystemPromptConfig (object only)
            expect(stringResult.contributors).toBeDefined();
            expect(objectResult.contributors).toBeDefined();
        });

        it('should produce consistent output type', () => {
            const stringResult: ValidatedSystemPromptConfig =
                SystemPromptConfigSchema.parse('test');
            const objectResult: ValidatedSystemPromptConfig = SystemPromptConfigSchema.parse({
                contributors: [{ id: 'test', type: 'static', priority: 0, content: 'test' }],
            });

            // Both results should have the same type structure
            expect(typeof stringResult.contributors).toBe('object');
            expect(typeof objectResult.contributors).toBe('object');
            expect(Array.isArray(stringResult.contributors)).toBe(true);
            expect(Array.isArray(objectResult.contributors)).toBe(true);
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle simple string prompt', () => {
            const result = SystemPromptConfigSchema.parse('You are a coding assistant');

            expect(result.contributors).toHaveLength(1);
            const contributor = result.contributors[0];
            expect(contributor?.type).toBe('static');
            if (contributor?.type === 'static') {
                expect((contributor! as any).content).toBe('You are a coding assistant');
            }
        });

        it('should handle complex contributors configuration', () => {
            const complexConfig = {
                contributors: [
                    {
                        id: 'main',
                        type: 'static' as const,
                        priority: 0,
                        content: 'You are Dexto, an advanced AI assistant.',
                        enabled: true,
                    },
                    {
                        id: 'context',
                        type: 'file' as const,
                        priority: 5,
                        files: [
                            path.join(process.cwd(), 'context.md'),
                            path.join(process.cwd(), 'guidelines.md'),
                        ],
                        enabled: true,
                        options: {
                            includeFilenames: true,
                            separator: '\n\n---\n\n',
                        },
                    },
                    {
                        id: 'date',
                        type: 'dynamic' as const,
                        priority: 10,
                        source: 'date',
                        enabled: true,
                    },
                ],
            };

            const result = SystemPromptConfigSchema.parse(complexConfig);
            expect(result.contributors).toHaveLength(3);
            expect(result.contributors.map((c) => c.id)).toEqual(['main', 'context', 'date']);
        });

        it('should handle template-style configuration', () => {
            const templateConfig = {
                contributors: [
                    {
                        id: 'primary',
                        type: 'static' as const,
                        priority: 0,
                        content:
                            "You are a helpful AI assistant demonstrating Dexto's capabilities.",
                    },
                    {
                        id: 'date',
                        type: 'dynamic' as const,
                        priority: 10,
                        source: 'date',
                        enabled: true,
                    },
                ],
            };

            const result = SystemPromptConfigSchema.parse(templateConfig);
            expect(result.contributors).toHaveLength(2);
            expect(result.contributors[0]?.id).toBe('primary');
            expect(result.contributors[1]?.id).toBe('date');
        });
    });
});
