import { describe, test, expect } from 'vitest';
import { resolveSubAgentLLM, type ResolveSubAgentLLMOptions } from './llm-resolution.js';
import type { LLMConfig } from '@dexto/core';

describe('resolveSubAgentLLM', () => {
    // Common sub-agent config (like explore-agent)
    const exploreAgentLLM: LLMConfig = {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        apiKey: '$ANTHROPIC_API_KEY',
    };

    describe('gateway provider scenarios (dexto/openrouter)', () => {
        test('parent with dexto + sub-agent with anthropic -> dexto + transformed model', () => {
            const parentLLM: LLMConfig = {
                provider: 'dexto',
                model: 'anthropic/claude-sonnet-4',
                apiKey: '$DEXTO_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM,
                parentLLM,
                subAgentId: 'explore-agent',
            });

            expect(result.resolution).toBe('gateway-transform');
            expect(result.llm.provider).toBe('dexto');
            expect(result.llm.model).toBe('anthropic/claude-haiku-4.5'); // Transformed
            expect(result.llm.apiKey).toBe('$DEXTO_API_KEY'); // Parent's key
            expect(result.reason).toContain('gateway');
            expect(result.reason).toContain('transformed');
        });

        test('parent with openrouter + sub-agent with openai -> openrouter + transformed model', () => {
            const subAgentLLM: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5-mini',
                apiKey: '$OPENAI_API_KEY',
            };
            const parentLLM: LLMConfig = {
                provider: 'openrouter',
                model: 'anthropic/claude-sonnet-4',
                apiKey: '$OPENROUTER_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM,
                parentLLM,
                subAgentId: 'test-agent',
            });

            expect(result.resolution).toBe('gateway-transform');
            expect(result.llm.provider).toBe('openrouter');
            expect(result.llm.model).toBe('openai/gpt-5-mini'); // Transformed
            expect(result.llm.apiKey).toBe('$OPENROUTER_API_KEY');
        });

        test('parent with dexto + sub-agent with google -> dexto + transformed model', () => {
            const subAgentLLM: LLMConfig = {
                provider: 'google',
                model: 'gemini-2.0-flash',
                apiKey: '$GOOGLE_API_KEY',
            };
            const parentLLM: LLMConfig = {
                provider: 'dexto',
                model: 'anthropic/claude-opus-4',
                apiKey: '$DEXTO_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM,
                parentLLM,
            });

            expect(result.resolution).toBe('gateway-transform');
            expect(result.llm.provider).toBe('dexto');
            expect(result.llm.model).toBe('google/gemini-2.0-flash-001'); // Transformed
            expect(result.llm.apiKey).toBe('$DEXTO_API_KEY');
        });
    });

    describe('same provider scenarios', () => {
        test('parent with anthropic + sub-agent with anthropic -> keeps sub-agent model', () => {
            const parentLLM: LLMConfig = {
                provider: 'anthropic',
                model: 'claude-opus-4-5-20251101',
                apiKey: '$MY_ANTHROPIC_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM,
                parentLLM,
                subAgentId: 'explore-agent',
            });

            expect(result.resolution).toBe('same-provider');
            expect(result.llm.provider).toBe('anthropic');
            expect(result.llm.model).toBe('claude-haiku-4-5-20251001'); // Sub-agent's model preserved
            expect(result.llm.apiKey).toBe('$MY_ANTHROPIC_KEY'); // Parent's credentials
            expect(result.reason).toContain("parent's credentials");
        });

        test('parent with openai + sub-agent with openai -> keeps sub-agent model', () => {
            const subAgentLLM: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5-mini',
                apiKey: '$OPENAI_API_KEY',
            };
            const parentLLM: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5',
                apiKey: '$USER_OPENAI_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM,
                parentLLM,
            });

            expect(result.resolution).toBe('same-provider');
            expect(result.llm.provider).toBe('openai');
            expect(result.llm.model).toBe('gpt-5-mini'); // Sub-agent's model
            expect(result.llm.apiKey).toBe('$USER_OPENAI_KEY'); // Parent's key
        });
    });

    describe('incompatible provider scenarios (fallback)', () => {
        test('parent with openai + sub-agent with anthropic -> fallback to parent config', () => {
            const parentLLM: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5',
                apiKey: '$OPENAI_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM,
                parentLLM,
                subAgentId: 'explore-agent',
            });

            expect(result.resolution).toBe('parent-fallback');
            expect(result.llm.provider).toBe('openai'); // Parent's provider
            expect(result.llm.model).toBe('gpt-5'); // Parent's model
            expect(result.llm.apiKey).toBe('$OPENAI_API_KEY');
            expect(result.reason).toContain('cannot use');
            expect(result.reason).toContain('dexto login');
        });

        test('parent with google + sub-agent with anthropic -> fallback to parent config', () => {
            const parentLLM: LLMConfig = {
                provider: 'google',
                model: 'gemini-2.0-pro',
                apiKey: '$GOOGLE_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM,
                parentLLM,
            });

            expect(result.resolution).toBe('parent-fallback');
            expect(result.llm.provider).toBe('google');
            expect(result.llm.model).toBe('gemini-2.0-pro');
        });
    });

    describe('edge cases', () => {
        test('works without subAgentId parameter', () => {
            const parentLLM: LLMConfig = {
                provider: 'dexto',
                model: 'anthropic/claude-sonnet-4',
                apiKey: '$DEXTO_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM,
                parentLLM,
                // No subAgentId
            });

            expect(result.resolution).toBe('gateway-transform');
            expect(result.reason).toContain('sub-agent'); // Uses generic label
        });

        test('preserves additional LLM config fields from sub-agent', () => {
            const subAgentLLM: LLMConfig = {
                provider: 'anthropic',
                model: 'claude-haiku-4-5-20251001',
                apiKey: '$ANTHROPIC_API_KEY',
                maxOutputTokens: 1000,
                temperature: 0.5,
            };
            const parentLLM: LLMConfig = {
                provider: 'dexto',
                model: 'anthropic/claude-sonnet-4',
                apiKey: '$DEXTO_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM,
                parentLLM,
            });

            expect(result.llm.maxOutputTokens).toBe(1000); // Preserved from sub-agent
            expect(result.llm.temperature).toBe(0.5); // Preserved from sub-agent
        });
    });

    describe('real-world explore-agent scenarios', () => {
        /**
         * These tests simulate what happens when coding-agent spawns explore-agent
         * in different user configurations.
         */

        test('new user with dexto (most common) -> explore-agent uses dexto + haiku', () => {
            // User ran `dexto setup` and chose dexto provider
            const codingAgentLLM: LLMConfig = {
                provider: 'dexto',
                model: 'anthropic/claude-sonnet-4',
                apiKey: '$DEXTO_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM, // explore-agent's bundled config
                parentLLM: codingAgentLLM,
                subAgentId: 'explore-agent',
            });

            // explore-agent should use dexto provider with haiku model
            expect(result.llm.provider).toBe('dexto');
            expect(result.llm.model).toBe('anthropic/claude-haiku-4.5');
            expect(result.llm.apiKey).toBe('$DEXTO_API_KEY');
            expect(result.resolution).toBe('gateway-transform');
        });

        test('user with direct anthropic API key -> explore-agent uses anthropic + haiku', () => {
            // User has their own Anthropic API key configured
            const codingAgentLLM: LLMConfig = {
                provider: 'anthropic',
                model: 'claude-opus-4-5-20251101',
                apiKey: '$ANTHROPIC_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM,
                parentLLM: codingAgentLLM,
                subAgentId: 'explore-agent',
            });

            // explore-agent should use user's anthropic credentials with haiku model
            expect(result.llm.provider).toBe('anthropic');
            expect(result.llm.model).toBe('claude-haiku-4-5-20251001'); // Original model preserved
            expect(result.llm.apiKey).toBe('$ANTHROPIC_API_KEY');
            expect(result.resolution).toBe('same-provider');
        });

        test('user with openai only -> explore-agent falls back to openai', () => {
            // User only has OpenAI configured (can't use Anthropic Haiku)
            const codingAgentLLM: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5',
                apiKey: '$OPENAI_API_KEY',
            };

            const result = resolveSubAgentLLM({
                subAgentLLM: exploreAgentLLM,
                parentLLM: codingAgentLLM,
                subAgentId: 'explore-agent',
            });

            // explore-agent falls back to parent's OpenAI config
            expect(result.llm.provider).toBe('openai');
            expect(result.llm.model).toBe('gpt-5');
            expect(result.llm.apiKey).toBe('$OPENAI_API_KEY');
            expect(result.resolution).toBe('parent-fallback');
            // Warning should suggest dexto login
            expect(result.reason).toContain('dexto login');
        });
    });
});
