import { describe, test, expect } from 'vitest';
import {
    applyCLIOverrides,
    applyUserPreferences,
    type CLIConfigOverrides,
} from './cli-overrides.js';
import type { AgentConfig } from '@dexto/agent-config';
// Note: applyUserPreferences accepts Partial<GlobalPreferences> since it only uses the llm field

function clone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

describe('CLI Overrides', () => {
    const baseConfig: AgentConfig = {
        systemPrompt: 'hi',
        mcpServers: {
            test: {
                type: 'stdio',
                command: 'node',
                args: ['agent-server.js'],
            },
        },
        llm: {
            provider: 'openai',
            model: 'gpt-5',
            apiKey: 'file-api-key',
        },
        toolConfirmation: {
            mode: 'manual',
            timeout: 120000,
            allowedToolsStorage: 'storage',
        },
    };

    test('applies CLI overrides correctly', () => {
        const cliOverrides: CLIConfigOverrides = {
            model: 'claude-sonnet-4-5-20250929',
            provider: 'anthropic',
            apiKey: 'cli-api-key',
        };

        const result = applyCLIOverrides(clone(baseConfig), cliOverrides);

        expect(result.llm.model).toBe('claude-sonnet-4-5-20250929');
        expect(result.llm.provider).toBe('anthropic');
        expect(result.llm.apiKey).toBe('cli-api-key');
    });

    test('applies partial CLI overrides', () => {
        const cliOverrides: CLIConfigOverrides = {
            model: 'gpt-5-mini',
            // Only override model, leave others unchanged
        };

        const result = applyCLIOverrides(clone(baseConfig), cliOverrides);

        expect(result.llm.model).toBe('gpt-5-mini'); // Overridden
        expect(result.llm.provider).toBe('openai'); // Original
        expect(result.llm.apiKey).toBe('file-api-key'); // Original
    });

    test('returns original config when no overrides provided', () => {
        const result = applyCLIOverrides(clone(baseConfig), undefined);

        expect(result).toEqual(baseConfig); // Should return baseConfig as-is
        expect(result).not.toBe(baseConfig); // Should be a copy
    });

    test('returns original config when empty overrides provided', () => {
        const result = applyCLIOverrides(clone(baseConfig), {});

        expect(result).toEqual(baseConfig); // Should return baseConfig as-is
        expect(result).not.toBe(baseConfig); // Should be a copy
    });

    test('does not mutate original config', () => {
        const originalConfig = clone(baseConfig);
        const cliOverrides: CLIConfigOverrides = {
            model: 'gpt-5-mini',
            provider: 'openai',
        };

        applyCLIOverrides(originalConfig, cliOverrides);

        // Original should be unchanged
        expect(originalConfig.llm.model).toBe('gpt-5');
        expect(originalConfig.llm.provider).toBe('openai');
    });

    test('preserves all non-LLM config fields', () => {
        const cliOverrides: CLIConfigOverrides = {
            model: 'gpt-5-mini',
        };

        const result = applyCLIOverrides(clone(baseConfig), cliOverrides);

        // Non-LLM fields should be preserved as-is (no schema transformation yet)
        expect(result.systemPrompt).toBe('hi'); // Raw value preserved
        expect(result.mcpServers?.test?.type).toBe('stdio');
        if (result.mcpServers?.test?.type === 'stdio') {
            expect(result.mcpServers.test.command).toBe('node');
            expect(result.mcpServers.test.args).toEqual(['agent-server.js']);
        }
        expect(result.toolConfirmation?.timeout).toBe(120000);
        expect(result.toolConfirmation?.allowedToolsStorage).toBe('storage');
    });

    test('handles undefined values in overrides gracefully', () => {
        const cliOverrides: CLIConfigOverrides = {
            model: 'gpt-5-mini',
            // provider, apiKey intentionally omitted to test undefined handling
        };

        const result = applyCLIOverrides(clone(baseConfig), cliOverrides);

        expect(result.llm.model).toBe('gpt-5-mini'); // Applied
        expect(result.llm.provider).toBe('openai'); // Original (undefined ignored)
        expect(result.llm.apiKey).toBe('file-api-key'); // Original (undefined ignored)
    });

    test('sets tool confirmation mode to auto-approve when override enabled', () => {
        const cliOverrides: CLIConfigOverrides = {
            autoApprove: true,
        };

        const result = applyCLIOverrides(clone(baseConfig), cliOverrides);

        expect(result.toolConfirmation?.mode).toBe('auto-approve');
        expect(result.toolConfirmation?.timeout).toBe(120000); // Existing fields preserved
    });
});

describe('applyUserPreferences', () => {
    const baseAgentConfig: AgentConfig = {
        systemPrompt: 'test agent',
        llm: {
            provider: 'anthropic',
            model: 'claude-haiku-4-5-20251001',
            apiKey: '$ANTHROPIC_API_KEY',
        },
    };

    test('applies user preferences fully (provider, model, apiKey)', () => {
        const preferences = {
            llm: {
                provider: 'openai' as const,
                model: 'gpt-5-mini',
                apiKey: '$OPENAI_API_KEY',
            },
        };

        const result = applyUserPreferences(clone(baseAgentConfig), preferences);

        expect(result.llm.provider).toBe('openai');
        expect(result.llm.model).toBe('gpt-5-mini');
        expect(result.llm.apiKey).toBe('$OPENAI_API_KEY');
    });

    test('applies dexto provider preferences', () => {
        const preferences = {
            llm: {
                provider: 'dexto' as const,
                model: 'anthropic/claude-sonnet-4',
                apiKey: '$DEXTO_API_KEY',
            },
        };

        const result = applyUserPreferences(clone(baseAgentConfig), preferences);

        expect(result.llm.provider).toBe('dexto');
        expect(result.llm.model).toBe('anthropic/claude-sonnet-4');
        expect(result.llm.apiKey).toBe('$DEXTO_API_KEY');
    });

    test('without llm preferences -> returns config unchanged', () => {
        const preferences = {};

        const result = applyUserPreferences(clone(baseAgentConfig), preferences);

        expect(result.llm.provider).toBe('anthropic');
        expect(result.llm.model).toBe('claude-haiku-4-5-20251001');
        expect(result.llm.apiKey).toBe('$ANTHROPIC_API_KEY');
    });

    test('preserves agent apiKey if user has no apiKey configured', () => {
        const preferences = {
            llm: {
                provider: 'anthropic' as const,
                model: 'claude-sonnet-4-5-20250929',
                // No apiKey specified
            },
        };

        const result = applyUserPreferences(clone(baseAgentConfig), preferences);

        expect(result.llm.provider).toBe('anthropic');
        expect(result.llm.model).toBe('claude-sonnet-4-5-20250929');
        expect(result.llm.apiKey).toBe('$ANTHROPIC_API_KEY'); // Original preserved
    });

    test('applies baseURL if provided in preferences', () => {
        const preferences = {
            llm: {
                provider: 'openai-compatible' as const,
                model: 'local-model',
                apiKey: 'test-key',
                baseURL: 'http://localhost:8080/v1',
            },
        };

        const result = applyUserPreferences(clone(baseAgentConfig), preferences);

        expect(result.llm.provider).toBe('openai-compatible');
        expect(result.llm.baseURL).toBe('http://localhost:8080/v1');
    });

    test('does not mutate original config', () => {
        const originalConfig = clone(baseAgentConfig);
        const preferences = {
            llm: {
                provider: 'openai' as const,
                model: 'gpt-5-mini',
                apiKey: '$OPENAI_API_KEY',
            },
        };

        applyUserPreferences(originalConfig, preferences);

        // Original should be unchanged
        expect(originalConfig.llm.provider).toBe('anthropic');
        expect(originalConfig.llm.model).toBe('claude-haiku-4-5-20251001');
    });
});
