import { describe, expect, it } from 'vitest';
import { buildProviderOptions } from './provider-options.js';

describe('buildProviderOptions', () => {
    it('returns undefined for providers with no special options', () => {
        expect(
            buildProviderOptions({ provider: 'groq', model: 'llama-3.1-70b', reasoning: undefined })
        ).toBeUndefined();
    });

    describe('openai', () => {
        it('maps reasoning presets to openai.reasoningEffort for reasoning-capable models', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5',
                    reasoning: { preset: 'low' },
                })
            ).toEqual({ openai: { reasoningEffort: 'low' } });

            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5',
                    reasoning: { preset: 'max' },
                })
            ).toEqual({ openai: { reasoningEffort: 'high' } });
        });

        it('supports xhigh only for codex-like models', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5.2-codex',
                    reasoning: { preset: 'max' },
                })
            ).toEqual({ openai: { reasoningEffort: 'xhigh' } });
        });

        it('maps off to reasoningEffort=none', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ openai: { reasoningEffort: 'none' } });
        });

        it('does not send reasoningEffort for non-reasoning models', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    reasoning: { preset: 'high' },
                })
            ).toBeUndefined();
        });
    });

    describe('anthropic', () => {
        it('enables sendReasoning by default and sets cacheControl', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-7-sonnet-20250219',
                    reasoning: { preset: 'auto' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                },
            });
        });

        it('maps budgetTokens to anthropic.thinking', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-7-sonnet-20250219',
                    reasoning: { preset: 'auto', budgetTokens: 1234 },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'enabled', budgetTokens: 1234 },
                },
            });
        });

        it('maps non-auto presets to effort', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-7-sonnet-20250219',
                    reasoning: { preset: 'max' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    effort: 'high',
                },
            });
        });

        it('maps off to sendReasoning=false and thinking disabled', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-7-sonnet-20250219',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: false,
                    thinking: { type: 'disabled' },
                },
            });
        });
    });

    describe('vertex', () => {
        it('maps vertex Claude models under anthropic providerOptions', () => {
            expect(
                buildProviderOptions({
                    provider: 'vertex',
                    model: 'claude-3-7-sonnet-20250219',
                    reasoning: { preset: 'high' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    effort: 'high',
                },
            });
        });
    });

    describe('google', () => {
        it('maps presets into google.thinkingConfig', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    reasoning: { preset: 'medium' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'medium' } },
            });
        });

        it('maps budgetTokens into google.thinkingConfig.thinkingBudget', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    reasoning: { preset: 'auto', budgetTokens: 987 },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 987 } },
            });
        });

        it('maps off into includeThoughts=false', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: false, thinkingLevel: 'minimal' } },
            });
        });
    });

    describe('bedrock', () => {
        it('returns empty bedrock options for auto (no-op)', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
                    reasoning: { preset: 'auto' },
                })
            ).toEqual({ bedrock: {} });
        });

        it('maps off to bedrock.reasoningConfig disabled', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ bedrock: { reasoningConfig: { type: 'disabled' } } });
        });
    });

    describe('openrouter/dexto', () => {
        it('requests reasoning by default (auto)', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'auto' },
                })
            ).toEqual({ openrouter: { includeReasoning: true } });
        });

        it('maps off to includeReasoning=false', () => {
            expect(
                buildProviderOptions({
                    provider: 'dexto',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ openrouter: { includeReasoning: false } });
        });

        it('maps presets to openrouter.reasoning.effort', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'high' },
                })
            ).toEqual({
                openrouter: {
                    includeReasoning: true,
                    reasoning: { enabled: true, effort: 'high' },
                },
            });
        });

        it('maps max to xhigh for codex models (best-effort passthrough)', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'max' },
                })
            ).toEqual({
                openrouter: {
                    includeReasoning: true,
                    reasoning: { enabled: true, effort: 'xhigh' },
                },
            });
        });

        it('maps xhigh to xhigh for codex models (best-effort passthrough)', () => {
            expect(
                buildProviderOptions({
                    provider: 'dexto',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'xhigh' },
                })
            ).toEqual({
                openrouter: {
                    includeReasoning: true,
                    reasoning: { enabled: true, effort: 'xhigh' },
                },
            });
        });

        it('maps budgetTokens to openrouter.reasoning.max_tokens', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'high', budgetTokens: 111 },
                })
            ).toEqual({
                openrouter: {
                    includeReasoning: true,
                    reasoning: { enabled: true, max_tokens: 111 },
                },
            });
        });
    });

    describe('openai-compatible', () => {
        it('does nothing for auto', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai-compatible',
                    model: 'whatever',
                    reasoning: { preset: 'auto' },
                })
            ).toBeUndefined();
        });

        it('maps off to reasoningEffort=none', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai-compatible',
                    model: 'whatever',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ openaiCompatible: { reasoningEffort: 'none' } });
        });

        it('maps high to reasoningEffort=high', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai-compatible',
                    model: 'whatever',
                    reasoning: { preset: 'high' },
                })
            ).toEqual({ openaiCompatible: { reasoningEffort: 'high' } });
        });
    });
});
