import { describe, expect, it } from 'vitest';
import { buildProviderOptions, getEffectiveReasoningBudgetTokens } from './provider-options.js';
import { ANTHROPIC_INTERLEAVED_THINKING_BETA } from '../reasoning/anthropic-betas.js';

describe('buildProviderOptions', () => {
    it('returns undefined for providers with no special options', () => {
        expect(
            buildProviderOptions({ provider: 'groq', model: 'llama-3.1-70b', reasoning: undefined })
        ).toBeUndefined();
    });

    describe('openai', () => {
        it('uses model-native default reasoning variant when none is provided', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5',
                    reasoning: undefined,
                })
            ).toEqual({ openai: { reasoningEffort: 'medium', reasoningSummary: 'auto' } });
        });

        it('maps explicit native efforts for supported models', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5.2',
                    reasoning: { variant: 'xhigh' },
                })
            ).toEqual({ openai: { reasoningEffort: 'xhigh', reasoningSummary: 'auto' } });

            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5.1',
                    reasoning: { variant: 'none' },
                })
            ).toEqual({ openai: { reasoningEffort: 'none' } });
        });

        it('does not send options for unsupported explicit variants', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5-pro',
                    reasoning: { variant: 'medium' },
                })
            ).toBeUndefined();
        });
    });

    describe('anthropic', () => {
        it('uses budget reasoning defaults for pre-adaptive Claude models', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-7-sonnet-20250219',
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'enabled', budgetTokens: 2048 },
                },
            });
        });

        it('supports disabling budget reasoning explicitly', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-7-sonnet-20250219',
                    reasoning: { variant: 'disabled' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: false,
                    thinking: { type: 'disabled' },
                },
            });
        });

        it('maps explicit budget tokens for budget-style Claude models', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-7-sonnet-20250219',
                    reasoning: { variant: 'enabled', budgetTokens: 1234 },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'enabled', budgetTokens: 1234 },
                },
            });
        });

        it('uses adaptive thinking for Claude >= 4.6', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-sonnet-4-6',
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'adaptive' },
                    effort: 'medium',
                },
            });

            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-opus-4-6',
                    reasoning: { variant: 'max' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'adaptive' },
                    effort: 'max',
                },
            });
        });
    });

    describe('vertex', () => {
        it('maps Vertex Claude models to Anthropic options', () => {
            expect(
                buildProviderOptions({
                    provider: 'vertex',
                    model: 'claude-3-7-sonnet@20250219',
                    reasoning: { variant: 'enabled' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'enabled', budgetTokens: 2048 },
                },
            });
        });

        it('maps Vertex Gemini models to Google options', () => {
            expect(
                buildProviderOptions({
                    provider: 'vertex',
                    model: 'gemini-3-flash-preview',
                    reasoning: { variant: 'minimal' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'minimal' } },
            });

            expect(
                buildProviderOptions({
                    provider: 'vertex',
                    model: 'gemini-2.5-pro',
                    reasoning: undefined,
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } },
            });
        });
    });

    describe('google', () => {
        it('maps Gemini 3 native thinking levels', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-3-flash-preview',
                    reasoning: { variant: 'high' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } },
            });
        });

        it('maps Gemini 2.5 budget controls', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    reasoning: { variant: 'enabled', budgetTokens: 987 },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 987 } },
            });

            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    reasoning: { variant: 'disabled' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: false } },
            });
        });
    });

    describe('bedrock', () => {
        it('uses Anthropic budget defaults for Bedrock Anthropic models', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
                })
            ).toEqual({
                bedrock: {
                    reasoningConfig: { type: 'enabled', budgetTokens: 2048 },
                    anthropicBeta: [ANTHROPIC_INTERLEAVED_THINKING_BETA],
                },
            });
        });

        it('maps Bedrock Anthropic disabled/enabled variants', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
                    reasoning: { variant: 'disabled' },
                })
            ).toEqual({ bedrock: { reasoningConfig: { type: 'disabled' } } });

            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
                    reasoning: { variant: 'enabled', budgetTokens: 987 },
                })
            ).toEqual({
                bedrock: {
                    reasoningConfig: { type: 'enabled', budgetTokens: 987 },
                    anthropicBeta: [ANTHROPIC_INTERLEAVED_THINKING_BETA],
                },
            });
        });

        it('maps Bedrock Nova effort variants', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'amazon.nova-premier-v1:0',
                })
            ).toEqual({
                bedrock: { reasoningConfig: { type: 'enabled', maxReasoningEffort: 'medium' } },
            });

            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'amazon.nova-premier-v1:0',
                    reasoning: { variant: 'high' },
                })
            ).toEqual({
                bedrock: { reasoningConfig: { type: 'enabled', maxReasoningEffort: 'high' } },
            });
        });
    });

    describe('openrouter/dexto-nova', () => {
        it('uses medium effort by default for supported models', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, effort: 'medium' },
                },
            });
        });

        it('supports explicit effort variants for OpenAI-family models', () => {
            expect(
                buildProviderOptions({
                    provider: 'dexto-nova',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { variant: 'high' },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, effort: 'high' },
                },
            });
        });

        it('maps Anthropic adaptive max to OpenRouter xhigh effort', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'anthropic/claude-opus-4.6',
                    reasoning: { variant: 'max' },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, effort: 'xhigh' },
                },
            });
        });

        it('uses max_tokens when budgetTokens is provided', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { variant: 'medium', budgetTokens: 111 },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, max_tokens: 111 },
                },
            });
        });

        it('supports Anthropic budget-style models with enabled variant', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'anthropic/claude-sonnet-4.5',
                    reasoning: { variant: 'enabled' },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                },
            });
        });

        it('supports Gemini-3 thinking-level variants', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'google/gemini-3-pro-preview',
                    reasoning: { variant: 'minimal' },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, effort: 'minimal' },
                },
            });
        });

        it('does not send options for unsupported variants or excluded families', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { variant: 'disabled' },
                })
            ).toBeUndefined();

            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'anthropic/claude-sonnet-4.5',
                    reasoning: { variant: 'high' },
                })
            ).toBeUndefined();

            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'deepseek/deepseek-r1:free',
                    reasoning: { variant: 'medium' },
                })
            ).toBeUndefined();
        });
    });

    describe('openai-compatible', () => {
        it('maps native none/high values for capable models', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai-compatible',
                    model: 'gpt-5',
                    reasoning: { variant: 'none' },
                })
            ).toEqual({ openaiCompatible: { reasoningEffort: 'none' } });

            expect(
                buildProviderOptions({
                    provider: 'openai-compatible',
                    model: 'gpt-5',
                    reasoning: { variant: 'high' },
                })
            ).toEqual({ openaiCompatible: { reasoningEffort: 'high' } });
        });

        it('returns undefined for unsupported variants or non-capable models', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai-compatible',
                    model: 'gpt-5',
                    reasoning: { variant: 'minimal' },
                })
            ).toBeUndefined();

            expect(
                buildProviderOptions({
                    provider: 'openai-compatible',
                    model: 'gpt-4o-mini',
                    reasoning: { variant: 'high' },
                })
            ).toBeUndefined();
        });
    });
});

describe('getEffectiveReasoningBudgetTokens', () => {
    it('extracts effective budgets from providerOptions (anthropic)', () => {
        const providerOptions = buildProviderOptions({
            provider: 'anthropic',
            model: 'claude-3-7-sonnet-20250219',
            reasoning: { variant: 'enabled' },
        });
        expect(getEffectiveReasoningBudgetTokens(providerOptions)).toBe(2048);
    });

    it('returns undefined when no budget is present', () => {
        const providerOptions = buildProviderOptions({
            provider: 'openai',
            model: 'gpt-5',
            reasoning: { variant: 'high' },
        });
        expect(getEffectiveReasoningBudgetTokens(providerOptions)).toBeUndefined();
    });
});
