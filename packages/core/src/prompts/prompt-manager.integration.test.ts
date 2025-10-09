import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { PromptManager } from './prompt-manager.js';
import { MCPManager } from '../mcp/manager.js';
import { ResourceManager } from '../resources/manager.js';
import { AgentEventBus } from '../events/index.js';
import { MemoryDatabaseStore } from '../storage/database/memory-database-store.js';
import type { ValidatedAgentConfig } from '../agent/schemas.js';
import { BlobService } from '../storage/blob/service.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PromptManager.resolvePrompt - Integration Tests', () => {
    let promptManager: PromptManager;
    let mcpManager: MCPManager;
    let resourceManager: ResourceManager;
    let eventBus: AgentEventBus;
    let database: MemoryDatabaseStore;
    let blobService: BlobService;
    let testPromptsDir: string;

    beforeAll(async () => {
        // Create test fixtures directory
        testPromptsDir = join(tmpdir(), `dexto-test-prompts-${Date.now()}`);
        await fs.mkdir(testPromptsDir, { recursive: true });

        // Create test file prompts
        await fs.writeFile(
            join(testPromptsDir, 'with-placeholders.md'),
            `---
description: Test prompt with placeholders
argument-hint: [style] [length]
---

# Test Prompt

Using style **$1** with length **$2**.
Content: $ARGUMENTS`
        );

        await fs.writeFile(
            join(testPromptsDir, 'without-placeholders.md'),
            `---
description: Test prompt without placeholders
---

# Simple Prompt

This is a simple prompt without any placeholders.`
        );

        await fs.writeFile(
            join(testPromptsDir, 'only-arguments.md'),
            `---
description: Test prompt with only $ARGUMENTS
---

# Arguments Only

Content: $ARGUMENTS`
        );

        await fs.writeFile(
            join(testPromptsDir, 'dollar-only.md'),
            `---
description: Template that contains only a literal dollar escape
---

# Dollar Escape Only

Price: $$100`
        );

        // Initialize services
        eventBus = new AgentEventBus();
        database = new InMemoryDatabase();
        await database.connect();

        blobService = new BlobService({
            type: 'in-memory',
        });

        resourceManager = new ResourceManager(blobService, eventBus);

        mcpManager = new MCPManager(resourceManager, eventBus);
        await mcpManager.start();

        const mockConfig: ValidatedAgentConfig = {
            llm: {
                provider: 'openai',
                model: 'gpt-4o',
                maxIterations: 10,
            },
            mcpServers: {},
            systemPrompt: {},
            storage: {
                type: 'in-memory',
            },
        };

        promptManager = new PromptManager(
            mcpManager,
            resourceManager,
            mockConfig,
            eventBus,
            database,
            testPromptsDir
        );
        await promptManager.initialize();
    });

    afterAll(async () => {
        await mcpManager.stop();
        await database.disconnect();
        // Clean up test directory
        await fs.rm(testPromptsDir, { recursive: true, force: true });
    });

    describe('File Prompts with Placeholders', () => {
        test('should expand $1, $2 and $ARGUMENTS correctly', async () => {
            const result = await promptManager.resolvePrompt('with-placeholders', {
                args: {
                    _positional: ['technical', '100', 'machine', 'learning'],
                },
            });

            expect(result.text).toContain('Using style **technical** with length **100**');
            expect(result.text).toContain('Content: machine learning');
            // Should NOT have duplicate args at the end
            expect(result.text).not.toMatch(/technical 100 machine learning$/);
        });

        test('should handle partial positional args', async () => {
            const result = await promptManager.resolvePrompt('with-placeholders', {
                args: {
                    _positional: ['concise'],
                },
            });

            expect(result.text).toContain('Using style **concise** with length ****');
            expect(result.text).toContain('Content:'); // $ARGUMENTS should be empty
        });

        test('should NOT append context when placeholders are used', async () => {
            const result = await promptManager.resolvePrompt('with-placeholders', {
                context: 'This is extra context',
                args: {
                    _positional: ['technical', '100', 'machine learning'],
                },
            });

            // Context should NOT appear as duplicate at the end
            expect(result.text).not.toContain('This is extra context');
            // But the positional args should be properly expanded
            expect(result.text).toContain('Content: machine learning');
        });

        test('should handle $ARGUMENTS only prompt', async () => {
            const result = await promptManager.resolvePrompt('only-arguments', {
                args: {
                    _positional: ['one', 'two', 'three'],
                },
            });

            expect(result.text).toContain('Content: one two three');
            // Should NOT have duplicate
            expect(result.text.split('one two three').length).toBe(2); // Once in expansion
        });
    });

    describe('File Prompts without Placeholders (context and $$ handling)', () => {
        test('should append context when no placeholders are present', async () => {
            const result = await promptManager.resolvePrompt('without-placeholders', {
                context: 'Context from option',
            });

            expect(result.text).toContain('This is a simple prompt without any placeholders');
            expect(result.text).toContain('Context: Context from option');
        });

        test('should not treat $$ as a placeholder and still append context (appended at end)', async () => {
            const result = await promptManager.resolvePrompt('dollar-only', {
                context: 'Cost details',
            });

            // Ensure $$ escape preserved as literal '$'
            expect(result.text).toContain('Price: $100');
            // And context appended at the end since there are no $1..$9 or $ARGUMENTS placeholders
            const priceIndex = result.text.indexOf('Price: $100');
            const contextIndex = result.text.indexOf('Context: Cost details');
            expect(priceIndex).toBeGreaterThanOrEqual(0);
            expect(contextIndex).toBeGreaterThan(priceIndex);
        });
    });

    describe('File Prompts without Placeholders', () => {
        test('should append context when no placeholders', async () => {
            const result = await promptManager.resolvePrompt('without-placeholders', {
                context: 'Additional context here',
            });

            expect(result.text).toContain('This is a simple prompt without any placeholders');
            expect(result.text).toContain('Context: Additional context here');
        });

        test('should append formatted args when no placeholders', async () => {
            const result = await promptManager.resolvePrompt('without-placeholders', {
                args: {
                    topic: 'AI',
                    length: '500',
                },
            });

            expect(result.text).toContain('This is a simple prompt without any placeholders');
            expect(result.text).toContain('Arguments:');
            expect(result.text).toContain('topic: AI');
            expect(result.text).toContain('length: 500');
        });

        test('should handle both context and args when no placeholders', async () => {
            const result = await promptManager.resolvePrompt('without-placeholders', {
                context: 'Extra context',
                args: {
                    foo: 'bar',
                },
            });

            // Context takes priority when no placeholders
            expect(result.text).toContain('Context: Extra context');
            // Args should not be appended when context is present
            expect(result.text).not.toContain('Arguments:');
        });
    });

    describe('Custom Prompts', () => {
        test('should handle custom prompt with positional args', async () => {
            const customPrompt = await promptManager.createCustomPrompt({
                name: 'custom-test',
                description: 'Custom test prompt',
                content: 'Process: $1 with mode $2',
            });

            expect(customPrompt.name).toBe('custom-test');

            const result = await promptManager.resolvePrompt('custom-test', {
                args: {
                    _positional: ['data', 'fast'],
                },
            });

            expect(result.text).toContain('Process: data with mode fast');
        });

        test('should handle custom prompt without placeholders', async () => {
            await promptManager.createCustomPrompt({
                name: 'custom-simple',
                description: 'Simple custom prompt',
                content: 'Simple content',
            });

            const result = await promptManager.resolvePrompt('custom-simple', {
                context: 'Custom context',
            });

            expect(result.text).toContain('Simple content');
            expect(result.text).toContain('Context: Custom context');
        });

        test('should map positional args to named arguments when schema is provided', async () => {
            await promptManager.createCustomPrompt({
                name: 'custom-named',
                description: 'Custom prompt with named args',
                content: 'Process: {{data}} with mode {{mode}}',
                arguments: [
                    { name: 'data', required: true },
                    { name: 'mode', required: false },
                ],
            });

            const result = await promptManager.resolvePrompt('custom-named', {
                args: {
                    _positional: ['dataset', 'fast'],
                },
            });

            expect(result.text).toContain('Process: dataset with mode fast');
        });
    });

    describe('Alias Resolution', () => {
        test('should resolve prompt by name', async () => {
            const result = await promptManager.resolvePrompt('with-placeholders', {
                args: {
                    _positional: ['style1', '50'],
                },
            });

            expect(result.text).toContain('style1');
        });

        test('should resolve prompt with slash prefix', async () => {
            const result = await promptManager.resolvePrompt('/with-placeholders', {
                args: {
                    _positional: ['style2', '75'],
                },
            });

            expect(result.text).toContain('style2');
        });
    });

    describe('Edge Cases', () => {
        test('should throw error for non-existent prompt', async () => {
            await expect(promptManager.resolvePrompt('does-not-exist', {})).rejects.toThrow();
        });

        test('should handle empty args gracefully', async () => {
            const result = await promptManager.resolvePrompt('without-placeholders', {});

            expect(result.text).toContain('This is a simple prompt without any placeholders');
        });

        test('should handle args with special characters', async () => {
            const result = await promptManager.resolvePrompt('with-placeholders', {
                args: {
                    _positional: ['style-with-dash', '100', 'text with spaces'],
                },
            });

            expect(result.text).toContain('style-with-dash');
            expect(result.text).toContain('text with spaces');
        });

        test('should preserve resource URIs in result', async () => {
            // This test verifies that resource URIs are passed through correctly
            const result = await promptManager.resolvePrompt('without-placeholders', {});

            expect(result.resources).toBeDefined();
            expect(Array.isArray(result.resources)).toBe(true);
        });
    });

    describe('Context vs Positional Args Priority', () => {
        test('prompts with placeholders should ignore context in args', async () => {
            const result = await promptManager.resolvePrompt('with-placeholders', {
                args: {
                    _positional: ['arg1', 'arg2', 'content here'],
                    _context: 'This context should be ignored',
                },
            });

            // Placeholders should be expanded
            expect(result.text).toContain('arg1');
            expect(result.text).toContain('arg2');
            expect(result.text).toContain('content here');

            // Context should NOT appear separately
            expect(result.text).not.toMatch(/This context should be ignored$/);
        });

        test('prompts without placeholders should use context from args', async () => {
            const result = await promptManager.resolvePrompt('without-placeholders', {
                args: {
                    _context: 'Context from args',
                },
            });

            expect(result.text).toContain('Context: Context from args');
        });

        test('context option should be passed to args._context', async () => {
            const result = await promptManager.resolvePrompt('without-placeholders', {
                context: 'Context from option',
            });

            expect(result.text).toContain('Context: Context from option');
        });
    });

    describe('Regression Tests for Bug Fixes', () => {
        test('REGRESSION: duplicate arguments should NOT appear at end of prompt with placeholders', async () => {
            // This was the original bug: /summarize technical 100 'machine learning'
            // was producing the expanded prompt PLUS 'technical 100 machine learning' at the end
            const result = await promptManager.resolvePrompt('with-placeholders', {
                args: {
                    _positional: ['technical', '100', 'machine learning'],
                },
            });

            const text = result.text;

            // Count occurrences of the positional args
            const technicalCount = (text.match(/technical/g) || []).length;
            const hundredCount = (text.match(/100/g) || []).length;

            // Should appear once in placeholder expansion, NOT duplicated at end
            expect(technicalCount).toBe(1);
            expect(hundredCount).toBe(1);

            // Should NOT end with the raw positional args
            expect(text).not.toMatch(/technical 100 machine learning\s*$/);
        });

        test('REGRESSION: $ARGUMENTS should only include remaining args after explicit placeholders', async () => {
            // $ARGUMENTS was incorrectly including ALL positional args, including those consumed by $1, $2
            const result = await promptManager.resolvePrompt('with-placeholders', {
                args: {
                    _positional: ['style', 'length', 'remaining', 'content'],
                },
            });

            // $1 consumes 'style', $2 consumes 'length'
            expect(result.text).toContain('Using style **style** with length **length**');

            // $ARGUMENTS should ONLY include 'remaining content', NOT 'style length remaining content'
            expect(result.text).toContain('Content: remaining content');
            expect(result.text).not.toContain('Content: style length remaining content');
        });

        test('REGRESSION: context should not be duplicated when placeholder detection works', async () => {
            // Context was being appended by both file-prompt-provider AND DextoAgent
            const result = await promptManager.resolvePrompt('with-placeholders', {
                context: 'Extra context',
                args: {
                    _positional: ['a', 'b', 'c'],
                },
            });

            // Context should NOT appear at all when placeholders are used
            const contextCount = (result.text.match(/Extra context/g) || []).length;
            expect(contextCount).toBe(0);
        });
    });

    describe('Starter Prompts', () => {
        test('should resolve starter prompts if available', async () => {
            // Starter prompts are configured in AgentConfig
            // This test verifies they work with resolvePrompt
            const prompts = await promptManager.list();
            const starterPrompts = Object.values(prompts).filter((p) => p.source === 'starter');

            if (starterPrompts.length > 0) {
                const firstStarter = starterPrompts[0];
                const result = await promptManager.resolvePrompt(firstStarter!.name, {});

                expect(result.text).toBeTruthy();
                expect(result.text.length).toBeGreaterThan(0);
            }
        });
    });
});
