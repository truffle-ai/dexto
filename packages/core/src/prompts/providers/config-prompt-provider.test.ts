import { describe, test, expect } from 'vitest';
import { ConfigPromptProvider } from './config-prompt-provider.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSilentMockLogger } from '../../logger/v2/test-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '__fixtures__');

const mockLogger = createSilentMockLogger();

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

        test('updatePrompts replaces prompts', async () => {
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

            // Update prompts
            const newPrompts = [
                {
                    type: 'inline' as const,
                    id: 'second',
                    prompt: 'Second content',
                },
                {
                    type: 'inline' as const,
                    id: 'third',
                    prompt: 'Third content',
                },
            ];

            provider.updatePrompts(newPrompts);
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

    describe('file prompts', () => {
        test('loads file with full frontmatter', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'full-frontmatter.md'),
                    showInStarters: true,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(1);
            expect(result.prompts[0]).toMatchObject({
                name: 'config:test-prompt',
                title: 'Test Prompt Title',
                description: 'A test prompt with full frontmatter',
                source: 'config',
            });
            expect(result.prompts[0]?.metadata).toMatchObject({
                type: 'file',
                category: 'testing',
                priority: 10,
                showInStarters: true,
                originalId: 'test-prompt',
            });
            // Should have parsed arguments from argument-hint
            expect(result.prompts[0]?.arguments).toEqual([
                { name: 'style', required: true },
                { name: 'length', required: false },
            ]);
        });

        test('loads file without frontmatter (uses filename as id)', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'minimal.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(1);
            expect(result.prompts[0]).toMatchObject({
                name: 'config:minimal',
                title: 'Minimal Prompt', // Extracted from # heading
                source: 'config',
            });
        });

        test('loads file with partial frontmatter', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'partial-frontmatter.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(1);
            expect(result.prompts[0]).toMatchObject({
                name: 'config:partial-test',
                title: 'Partial Frontmatter', // From heading since not in frontmatter
                description: 'Only id and description provided',
                source: 'config',
            });
        });

        test('loads Claude Code SKILL.md format (uses name: instead of id:)', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'claude-skill.md'),
                    namespace: 'my-plugin',
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(1);
            expect(result.prompts[0]).toMatchObject({
                // name: field in frontmatter should be used as id
                name: 'config:my-plugin:test-skill',
                displayName: 'my-plugin:test-skill',
                description: 'A test skill using Claude Code SKILL.md format with name field.',
                source: 'config',
            });
        });

        test('gets file prompt content', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'minimal.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.getPrompt('config:minimal');

            const text = (result.messages?.[0]?.content as any).text as string;
            expect(text).toContain('Minimal Prompt');
            expect(text).toContain('minimal prompt without frontmatter');
        });

        test('skips file with invalid prompt name', async () => {
            const warnings: string[] = [];
            const warnLogger = {
                ...mockLogger,
                warn: (msg: string) => warnings.push(msg),
                createChild: () => warnLogger,
            };

            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'invalid-name.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, warnLogger as any);
            const result = await provider.listPrompts();

            // Should be skipped due to invalid name
            expect(result.prompts).toHaveLength(0);
            expect(warnings.some((w) => w.includes('Invalid prompt name'))).toBe(true);
        });

        test('skips non-existent file gracefully', async () => {
            const warnings: string[] = [];
            const warnLogger = {
                ...mockLogger,
                warn: (msg: string) => warnings.push(msg),
                createChild: () => warnLogger,
            };

            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'does-not-exist.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, warnLogger as any);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(0);
            expect(warnings.some((w) => w.includes('not found'))).toBe(true);
        });

        test('mixed inline and file prompts', async () => {
            const config = makeAgentConfig([
                {
                    type: 'inline',
                    id: 'inline-one',
                    prompt: 'Inline content',
                    priority: 5,
                },
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'full-frontmatter.md'),
                    showInStarters: true,
                },
                {
                    type: 'inline',
                    id: 'inline-two',
                    prompt: 'Another inline',
                    priority: 1,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(3);
            // Sorted by priority: file (10), inline-one (5), inline-two (1)
            expect(result.prompts.map((p) => p.name)).toEqual([
                'config:test-prompt', // priority 10 from file
                'config:inline-one', // priority 5
                'config:inline-two', // priority 1
            ]);
        });

        test('applies arguments to file prompt content', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'full-frontmatter.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.getPrompt('config:test-prompt', {
                _positional: ['detailed'],
            });

            const text = (result.messages?.[0]?.content as any).text as string;
            // $ARGUMENTS should be expanded
            expect(text).toContain('detailed style');
        });

        test('SKILL.md uses parent directory name as id (Claude Code convention)', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'my-test-skill', 'SKILL.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(1);
            expect(result.prompts[0]).toMatchObject({
                // Should use directory name "my-test-skill" as id, not "SKILL"
                name: 'config:my-test-skill',
                displayName: 'my-test-skill',
                description: 'Test skill using directory name as id',
                source: 'config',
            });
        });

        test('parses context: fork from SKILL.md frontmatter', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'my-test-skill', 'SKILL.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const result = await provider.listPrompts();

            expect(result.prompts).toHaveLength(1);
            // context should be parsed from frontmatter
            expect(result.prompts[0]?.context).toBe('fork');
        });

        test('getPromptDefinition includes context field', async () => {
            const config = makeAgentConfig([
                {
                    type: 'file',
                    file: join(FIXTURES_DIR, 'my-test-skill', 'SKILL.md'),
                    showInStarters: false,
                },
            ]);

            const provider = new ConfigPromptProvider(config, mockLogger);
            const def = await provider.getPromptDefinition('config:my-test-skill');

            expect(def).toMatchObject({
                name: 'config:my-test-skill',
                context: 'fork',
            });
        });
    });
});
