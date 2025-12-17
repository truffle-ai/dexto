import { describe, it, expect } from 'vitest';
import { enrichAgentConfig } from './config-enrichment.js';
import type { AgentConfig } from '@dexto/core';

// TODO: Add more comprehensive tests for config-enrichment:
// - Test discoverCommandPrompts with actual temp directories
// - Test path resolution for per-agent logs, database, blobs
// - Test execution context detection (dexto-source, dexto-project, global-cli)
// - Integration test with real filesystem to verify deduplication end-to-end

describe('enrichAgentConfig', () => {
    describe('prompt deduplication', () => {
        it('should not duplicate prompts when same file path exists in config and discovered', () => {
            // This test verifies the deduplication logic works correctly
            // by checking that the enriched config doesn't have duplicate file paths

            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                },
                prompts: [
                    { type: 'file', file: '/path/to/prompt1.md' },
                    { type: 'file', file: '/path/to/prompt2.md' },
                    { type: 'inline', id: 'inline-prompt', prompt: 'test prompt' },
                ],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // Verify prompts array exists and config prompts are preserved
            expect(enriched.prompts).toBeDefined();
            expect(enriched.prompts!.length).toBeGreaterThanOrEqual(3);

            // Verify no duplicate file paths
            const filePaths = enriched
                .prompts!.filter((p): p is { type: 'file'; file: string } => p.type === 'file')
                .map((p) => p.file);

            const uniquePaths = new Set(filePaths);
            expect(filePaths.length).toBe(uniquePaths.size);
        });

        it('should preserve inline prompts without deduplication issues', () => {
            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                },
                prompts: [{ type: 'inline', id: 'test-prompt', prompt: 'Hello world' }],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // Inline prompts should be preserved
            const inlinePrompts = enriched.prompts?.filter((p) => p.type === 'inline');
            expect(inlinePrompts).toHaveLength(1);
        });

        it('should handle empty prompts array', () => {
            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                },
                prompts: [],
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // Should not throw and prompts should be defined
            expect(enriched.prompts).toBeDefined();
        });

        it('should handle undefined prompts', () => {
            const baseConfig: AgentConfig = {
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-opus',
                },
            };

            const enriched = enrichAgentConfig(baseConfig, 'test-agent');

            // Should not throw - prompts may or may not be defined depending on discovered prompts
            expect(() => enriched).not.toThrow();
        });
    });
});
