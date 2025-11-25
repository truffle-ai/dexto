import { describe, test, expect, beforeEach } from 'vitest';
import { ConfigPromptProvider } from './config-prompt-provider.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';

const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    silly: () => {},
    trackException: () => {},
    createChild: () => mockLogger,
    destroy: async () => {},
} as any;

function makeAgentConfig(prompts: any[]): ValidatedAgentConfig {
    return { prompts } as ValidatedAgentConfig;
}

describe('ConfigPromptProvider', () => {
    describe('inline prompts', () => {
        test('lists inline prompts correctly', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'test-prompt',
                    title: 'Test Prompt',
                    description: 'A test prompt',
                    prompt: 'This is the prompt content',
                    category: 'testing',
                    priority: 1,
                    showInStarters: true,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(1);
            expect(result.prompts[0]).toMatchObject({
                name: 'config:test-prompt',
                title: 'Test Prompt',
                description: 'A test prompt',
                source: 'config',
            });
            expect(result.prompts[0]?.metadata).toMatchObject({
                type: 'inline',
                category: 'testing',
                priority: 1,
                showInStarters: true,
                originalId: 'test-prompt',
            });
        });

        test('gets inline prompt content', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'simple',
                    title: 'Simple',
                    description: 'Simple prompt',
                    prompt: 'Hello world',
                    category: 'general',
                    priority: 0,
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.getPrompt('config:simple');

            expect(result.messages).toHaveLength(1);
            expect((result.messages?.[0]?.content as any).text).toBe('Hello world');
        });

        test('sorts prompts by priority (higher first)', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'low',
                    prompt: 'Low priority',
                    priority: 1,
                },
                {
                    type: 'inline',
                    id: 'high',
                    prompt: 'High priority',
                    priority: 10,
                },
                {
                    type: 'inline',
                    id: 'medium',
                    prompt: 'Medium priority',
                    priority: 5,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts.map((p) => p.name)).toEqual([
                'config:high',
                'config:medium',
                'config:low',
            ]);
        });

        test('throws error for non-existent prompt', async () => {
            const config = makeAgentConfig([]);
            const provider = new ConfigPromptProvider(config, mockLogger);

            await expect(provider.getPrompt('config:nonexistent')).rejects.toThrow();
        });
    });

    describe('applyArguments', () => {
        test('appends Context at END when no placeholders', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 's1',
                    title: 'T',
                    description: 'D',
                    prompt: 'Starter content',
                    category: 'cat',
                    priority: 1,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const res = await provider.getPrompt('config:s1', { _context: 'CTX' } as any);
            const text = (res.messages?.[0]?.content as any).text as string;

            expect(text).toBe('Starter content\n\nContext: CTX');
        });

        test('does not append when positional placeholders present ($1)', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 's2',
                    title: 'T',
                    description: 'D',
                    prompt: 'Use $1 style',
                    category: 'cat',
                    priority: 1,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const res = await provider.getPrompt('config:s2', {
                _positional: ['value'],
                _context: 'CTX',
            } as any);
            const text = (res.messages?.[0]?.content as any).text as string;

            // Placeholder expanded, context not appended
            expect(text).toBe('Use value style');
        });

        test('expands $ARGUMENTS and does not append context when placeholders used', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'p1',
                    prompt: 'Content: $ARGUMENTS',
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const res = await provider.getPrompt('config:p1', {
                _positional: ['one', 'two'],
                _context: 'should-not-append',
            });

            const text = (res.messages?.[0]?.content as any).text as string;
            expect(text).toContain('Content: one two');
            expect(text.includes('should-not-append')).toBe(false);
        });

        test('appends Arguments at END when no placeholders and no context', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'np2',
                    prompt: 'Alpha',
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const res = await provider.getPrompt('config:np2', { a: '1', b: '2' } as any);
            const text = (res.messages?.[0]?.content as any).text as string;

            expect(text).toBe('Alpha\n\nArguments: a: 1, b: 2');
        });

        test('ignores internal keys starting with underscore', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'test',
                    prompt: 'Test',
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const res = await provider.getPrompt('config:test', {
                _internal: 'ignored',
                visible: 'shown',
            } as any);
            const text = (res.messages?.[0]?.content as any).text as string;

            expect(text).toBe('Test\n\nArguments: visible: shown');
            expect(text).not.toContain('_internal');
        });
    });

    describe('getPromptDefinition', () => {
        test('returns prompt definition for existing prompt', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'def-test',
                    title: 'Definition Test',
                    description: 'Test description',
                    prompt: 'Content',
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const def = await provider.getPromptDefinition('config:def-test');

            expect(def).toEqual({
                name: 'config:def-test',
                title: 'Definition Test',
                description: 'Test description',
            });
        });

        test('returns null for non-existent prompt', async () => {
            const config = makeAgentConfig([]);
            const provider = new ConfigPromptProvider(config, mockLogger);
            const def = await provider.getPromptDefinition('config:missing');

            expect(def).toBeNull();
        });
    });

    describe('cache management', () => {
        test('invalidateCache clears the cache', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'cached',
                    prompt: 'Cached content',
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);

            // First access builds cache
            const result1 = await provider.listPrompts();
            expect(result1.prompts).toHaveLength(1);

            // Invalidate
            provider.invalidateCache();

            // Still works after invalidation (rebuilds cache)
            const result2 = await provider.listPrompts();
            expect(result2.prompts).toHaveLength(1);
        });

        test('updateConfig replaces prompts', async () => {
            const config1 = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'first',
                    prompt: 'First content',
                },
            ]);

            const provider = new ConfigPromptProvider(config1, mockLogger);
            let result = await provider.listPrompts();
            expect(result.prompts).toHaveLength(1);
            expect(result.prompts[0]?.name).toBe('config:first');

            // Update config
            const config2 = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'second',
                    prompt: 'Second content',
                },
                {
                    type: 'inline',
                    id: 'third',
                    prompt: 'Third content',
                },
            ]);

            provider.updateConfig(config2);
            result = await provider.listPrompts();
            expect(result.prompts).toHaveLength(2);
            expect(result.prompts.map((p) => p.name)).toContain('config:second');
            expect(result.prompts.map((p) => p.name)).toContain('config:third');
        });
    });

    describe('getSource', () => {
        test('returns "config"', () => {
            const config = makeAgentConfig([]);
            const provider = new ConfigPromptProvider(config, mockLogger);
            expect(provider.getSource()).toBe('config');
        });
    });
});
