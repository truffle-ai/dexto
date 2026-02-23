import { describe, expect, it } from 'vitest';
import { buildProviderOptions, getEffectiveReasoningBudgetTokens } from './provider-options.js';

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

        it('supports xhigh for models that support it', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5.2',
                    reasoning: { preset: 'max' },
                })
            ).toEqual({ openai: { reasoningEffort: 'xhigh' } });

            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5.2-codex',
                    reasoning: { preset: 'max' },
                })
            ).toEqual({ openai: { reasoningEffort: 'xhigh' } });
        });

        it('coerces off to the lowest supported effort per model', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ openai: { reasoningEffort: 'minimal' } });

            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5.1',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ openai: { reasoningEffort: 'none' } });
        });

        it('coerces unsupported levels to avoid invalid OpenAI API calls', () => {
            expect(
                buildProviderOptions({
                    provider: 'openai',
                    model: 'gpt-5-pro',
                    reasoning: { preset: 'low' },
                })
            ).toEqual({ openai: { reasoningEffort: 'high' } });
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
        it('enables thinking by default for reasoning-capable models and sets cacheControl', () => {
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
                    thinking: { type: 'enabled', budgetTokens: 2048 },
                },
            });
        });

        it('uses adaptive thinking (effort) for Claude 4.6 models', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-sonnet-4-6',
                    reasoning: { preset: 'auto' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'adaptive' },
                    effort: 'medium',
                },
            });
        });

        it('ignores budgetTokens for Claude 4.6 models (adaptive thinking)', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-opus-4-6',
                    reasoning: { preset: 'auto', budgetTokens: 1234 },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'adaptive' },
                    effort: 'medium',
                },
            });
        });

        it('does not send thinking budgets for non-reasoning models (even if budgetTokens is set)', () => {
            expect(
                buildProviderOptions({
                    provider: 'anthropic',
                    model: 'claude-3-5-sonnet-20240620',
                    reasoning: { preset: 'auto', budgetTokens: 1234 },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: false,
                },
            });
        });

        it('maps explicit budgetTokens to anthropic.thinking', () => {
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

        it('maps presets to default thinking budgets', () => {
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
                    thinking: { type: 'enabled', budgetTokens: 8192 },
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
                    model: 'claude-3-7-sonnet@20250219',
                    reasoning: { preset: 'high' },
                })
            ).toEqual({
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: true,
                    thinking: { type: 'enabled', budgetTokens: 4096 },
                },
            });
        });

        it('maps vertex Gemini models under google providerOptions', () => {
            expect(
                buildProviderOptions({
                    provider: 'vertex',
                    model: 'gemini-2.5-pro',
                    reasoning: { preset: 'medium' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } },
            });
        });

        it('maps presets into google.thinkingConfig for Vertex Gemini 3 models', () => {
            expect(
                buildProviderOptions({
                    provider: 'vertex',
                    model: 'gemini-3-flash-preview',
                    reasoning: { preset: 'medium' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'medium' } },
            });
        });

        it('uses adaptive thinking (effort) for Claude 4.6 models', () => {
            expect(
                buildProviderOptions({
                    provider: 'vertex',
                    model: 'claude-opus-4-6',
                    reasoning: { preset: 'max' },
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

    describe('google', () => {
        it('maps presets into google.thinkingConfig for Gemini 3 models', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-3-flash-preview',
                    reasoning: { preset: 'medium' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'medium' } },
            });
        });

        it('maps presets into google.thinkingConfig.thinkingBudget for Gemini 2.5 models', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    reasoning: { preset: 'medium' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } },
            });
        });

        it('omits thinkingBudget for auto when no explicit budgetTokens are set', () => {
            expect(
                buildProviderOptions({
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    reasoning: { preset: 'auto' },
                })
            ).toEqual({
                google: { thinkingConfig: { includeThoughts: true } },
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
                google: { thinkingConfig: { includeThoughts: false } },
            });
        });
    });

    describe('bedrock', () => {
        it('returns empty bedrock options for auto (no-op)', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
                    reasoning: { preset: 'auto' },
                })
            ).toEqual({ bedrock: {} });
        });

        it('maps off to bedrock.reasoningConfig disabled', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ bedrock: { reasoningConfig: { type: 'disabled' } } });
        });

        it('maps active presets to bedrock.reasoningConfig enabled', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
                    reasoning: { preset: 'high' },
                })
            ).toEqual({
                bedrock: { reasoningConfig: { type: 'enabled', maxReasoningEffort: 'high' } },
            });
        });

        it('does not send reasoningConfig for non-reasoning Bedrock Claude models', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-instant-v1:2',
                    reasoning: { preset: 'high' },
                })
            ).toEqual({ bedrock: {} });
        });

        it('does not send reasoningConfig for non-capable models', () => {
            expect(
                buildProviderOptions({
                    provider: 'bedrock',
                    model: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
                    reasoning: { preset: 'high' },
                })
            ).toEqual({ bedrock: {} });
        });
    });

    describe('openrouter/dexto-nova', () => {
        it('requests reasoning by default (auto)', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'auto' },
                })
            ).toEqual({ openrouter: { include_reasoning: true } });
        });

        it('applies budgetTokens even when preset is auto', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'auto', budgetTokens: 111 },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, max_tokens: 111 },
                },
            });
        });

        it('maps off to include_reasoning=false', () => {
            expect(
                buildProviderOptions({
                    provider: 'dexto-nova',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'off' },
                })
            ).toEqual({ openrouter: { include_reasoning: false } });
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
                    include_reasoning: true,
                    reasoning: { enabled: true, effort: 'high' },
                },
            });
        });

        it('maps max to high', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5',
                    reasoning: { preset: 'max' },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, effort: 'high' },
                },
            });
        });

        it('maps xhigh to high', () => {
            expect(
                buildProviderOptions({
                    provider: 'dexto-nova',
                    model: 'openai/gpt-5',
                    reasoning: { preset: 'xhigh' },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
                    reasoning: { enabled: true, effort: 'high' },
                },
            });
        });

        it('budgetTokens overrides preset effort (max_tokens only)', () => {
            expect(
                buildProviderOptions({
                    provider: 'openrouter',
                    model: 'openai/gpt-5.2-codex',
                    reasoning: { preset: 'high', budgetTokens: 111 },
                })
            ).toEqual({
                openrouter: {
                    include_reasoning: true,
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

describe('getEffectiveReasoningBudgetTokens', () => {
    it('extracts effective budgets from providerOptions (anthropic)', () => {
        const providerOptions = buildProviderOptions({
            provider: 'anthropic',
            model: 'claude-3-7-sonnet-20250219',
            reasoning: { preset: 'medium' },
        });
        expect(getEffectiveReasoningBudgetTokens(providerOptions)).toBe(2048);
    });

    it('returns undefined when no budget is present', () => {
        const providerOptions = buildProviderOptions({
            provider: 'openai',
            model: 'gpt-5',
            reasoning: { preset: 'high' },
        });
        expect(getEffectiveReasoningBudgetTokens(providerOptions)).toBeUndefined();
    });
});
