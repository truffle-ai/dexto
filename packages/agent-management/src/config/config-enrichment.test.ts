import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig } from '@dexto/agent-config';

// Mock the discover-prompts module (separate file, so mock works!)
vi.mock('./discover-prompts.js', () => ({
    discoverCommandPrompts: vi.fn(() => []),
    discoverAgentInstructionFile: vi.fn(() => null),
}));

// Mock the plugins module to prevent real filesystem discovery
vi.mock('../plugins/index.js', () => ({
    discoverClaudeCodePlugins: vi.fn(() => []),
    loadClaudeCodePlugin: vi.fn(() => ({ manifest: {}, commands: [], warnings: [] })),
    discoverStandaloneSkills: vi.fn(() => []),
}));

// Import after mock is set up
import { enrichAgentConfig } from './config-enrichment.js';
import { discoverAgentInstructionFile, discoverCommandPrompts } from './discover-prompts.js';

// TODO: Add more comprehensive tests for config-enrichment:
// - Test path resolution for per-agent logs, database, blobs
// - Test execution context detection (dexto-source, dexto-project, global-cli)

describe('enrichAgentConfig', () => {
    beforeEach(() => {
        vi.mocked(discoverCommandPrompts).mockReset();
        vi.mocked(discoverCommandPrompts).mockReturnValue([]);
        vi.mocked(discoverAgentInstructionFile).mockReset();
        vi.mocked(discoverAgentInstructionFile).mockReturnValue(null);
    });

    describe('logger defaults', () => {
        it('should default to silent logger in interactive CLI mode (session logs are handled in core)', () => {
            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5',
                    apiKey: 'test-key',
                },
                systemPrompt: 'You are a helpful assistant.',
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent', {
                isInteractiveCli: true,
            });

            expect(enriched.logger).toEqual({
                level: 'error',
                transports: [{ type: 'silent' }],
            });
        });

        it('should default to console logger in non-interactive mode (session logs are handled in core)', () => {
            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5',
                    apiKey: 'test-key',
                },
                systemPrompt: 'You are a helpful assistant.',
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent', {
                isInteractiveCli: false,
            });

            expect(enriched.logger).toEqual({
                level: 'error',
                transports: [{ type: 'console', colorize: true }],
            });
        });
    });

    describe('prompt deduplication', () => {
        it('should allow disabling instruction file discovery', () => {
            vi.mocked(discoverAgentInstructionFile).mockReturnValue('/test/AGENTS.md');

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5',
                    apiKey: 'test-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                agentFile: { discoverInCwd: false },
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            expect(enriched.systemPrompt).toBe('You are a helpful assistant.');
            expect(discoverAgentInstructionFile).not.toHaveBeenCalled();
        });

        it('should deduplicate when same file path exists in config and discovered prompts', () => {
            // Setup: discovered prompts include a file that's also in config
            const sharedFilePath = '/projects/myapp/commands/shared-prompt.md';
            const discoveredOnlyPath = '/projects/myapp/commands/discovered-only.md';

            vi.mocked(discoverCommandPrompts).mockReturnValue([
                { type: 'file', file: sharedFilePath },
                { type: 'file', file: discoveredOnlyPath },
            ]);

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                    apiKey: 'test-api-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                prompts: [
                    { type: 'file', file: sharedFilePath }, // Same as discovered
                    { type: 'file', file: '/config/only-prompt.md' },
                ],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // Should have 3 prompts: 2 from config + 1 discovered-only (not the duplicate)
            expect(enriched.prompts).toHaveLength(3);

            // Verify no duplicate file paths
            const filePaths = enriched
                .prompts!.filter((p): p is { type: 'file'; file: string } => p.type === 'file')
                .map((p) => p.file);

            expect(filePaths).toContain(sharedFilePath);
            expect(filePaths).toContain('/config/only-prompt.md');
            expect(filePaths).toContain(discoveredOnlyPath);

            // Count occurrences of shared path - should be exactly 1
            const sharedPathCount = filePaths.filter((p) => p === sharedFilePath).length;
            expect(sharedPathCount).toBe(1);
        });

        it('should deduplicate with different path formats (resolved paths)', () => {
            // Test that path.resolve normalization works with different path representations
            vi.mocked(discoverCommandPrompts).mockReturnValue([
                // Discovered path uses parent directory traversal
                { type: 'file', file: '/projects/myapp/commands/../commands/prompt.md' },
            ]);

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                    apiKey: 'test-api-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                prompts: [
                    // Config uses clean absolute path - path.resolve normalizes both to same path
                    { type: 'file', file: '/projects/myapp/commands/prompt.md' },
                ],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // Should have only 1 prompt (deduplicated)
            const filePaths = enriched
                .prompts!.filter((p): p is { type: 'file'; file: string } => p.type === 'file')
                .map((p) => p.file);

            expect(filePaths).toHaveLength(1);
        });

        it('should preserve config prompts when no discovered prompts overlap', () => {
            vi.mocked(discoverCommandPrompts).mockReturnValue([
                { type: 'file', file: '/discovered/prompt1.md' },
                { type: 'file', file: '/discovered/prompt2.md' },
            ]);

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                    apiKey: 'test-api-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                prompts: [
                    { type: 'file', file: '/config/prompt1.md' },
                    { type: 'inline', id: 'inline-prompt', prompt: 'test prompt' },
                ],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // Should have all 4 prompts (2 config + 2 discovered, no overlap)
            expect(enriched.prompts).toHaveLength(4);
        });

        it('should preserve inline prompts without deduplication issues', () => {
            vi.mocked(discoverCommandPrompts).mockReturnValue([]);

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                    apiKey: 'test-api-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                prompts: [{ type: 'inline', id: 'test-prompt', prompt: 'Hello world' }],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            const inlinePrompts = enriched.prompts?.filter((p) => p.type === 'inline');
            expect(inlinePrompts).toHaveLength(1);
        });

        it('should handle empty config prompts with discovered prompts', () => {
            vi.mocked(discoverCommandPrompts).mockReturnValue([
                { type: 'file', file: '/discovered/prompt.md' },
            ]);

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                    apiKey: 'test-api-key',
                },
                systemPrompt: 'You are a helpful assistant.',
                prompts: [],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            expect(enriched.prompts).toHaveLength(1);
        });

        it('should handle undefined config prompts with discovered prompts', () => {
            vi.mocked(discoverCommandPrompts).mockReturnValue([
                { type: 'file', file: '/discovered/prompt.md' },
            ]);

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                    apiKey: 'test-api-key',
                },
                systemPrompt: 'You are a helpful assistant.',
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            expect(enriched.prompts).toHaveLength(1);
        });

        it('should not add prompts when no discovered prompts and no config prompts', () => {
            vi.mocked(discoverCommandPrompts).mockReturnValue([]);

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                    apiKey: 'test-api-key',
                },
                systemPrompt: 'You are a helpful assistant.',
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // prompts should be undefined (not modified)
            expect(enriched.prompts).toBeUndefined();
        });
    });
});
