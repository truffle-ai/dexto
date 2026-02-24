import { describe, expect, it } from 'vitest';
import { getReasoningSupport } from './presets.js';

describe('getReasoningSupport', () => {
    it('returns only off for non-reasoning models', () => {
        expect(getReasoningSupport('openai', 'gpt-4o-mini')).toEqual({
            capable: false,
            supportedPresets: ['off'],
            supportsBudgetTokens: false,
        });
    });

    it('returns openai presets for reasoning-capable models', () => {
        expect(getReasoningSupport('openai', 'gpt-5')).toEqual({
            capable: true,
            supportedPresets: ['off', 'low', 'medium', 'high'],
            supportsBudgetTokens: false,
        });
    });

    it('includes xhigh for codex models', () => {
        const support = getReasoningSupport('openai', 'gpt-5.2-codex');
        expect(support.capable).toBe(true);
        expect(support.supportedPresets).toContain('xhigh');
    });

    it('returns budget token support for anthropic reasoning models', () => {
        expect(getReasoningSupport('anthropic', 'claude-3-7-sonnet-20250219')).toEqual({
            capable: true,
            supportedPresets: ['off', 'low', 'medium', 'high', 'max'],
            supportsBudgetTokens: true,
        });
    });

    it('does not advertise budget tokens for Claude 4.6 (adaptive thinking)', () => {
        expect(getReasoningSupport('anthropic', 'claude-sonnet-4-6')).toEqual({
            capable: true,
            supportedPresets: ['off', 'low', 'medium', 'high', 'max'],
            supportsBudgetTokens: false,
        });
    });

    it('does not advertise budget tokens for Gemini 3 (thinkingLevel-only)', () => {
        expect(getReasoningSupport('google', 'gemini-3-flash-preview')).toEqual({
            capable: true,
            supportedPresets: ['off', 'low', 'medium', 'high', 'max'],
            supportsBudgetTokens: false,
        });
    });

    it('advertises budget tokens for Gemini 2.5 (thinkingBudget)', () => {
        expect(getReasoningSupport('google', 'gemini-2.5-pro')).toEqual({
            capable: true,
            supportedPresets: ['off', 'low', 'medium', 'high', 'max'],
            supportsBudgetTokens: true,
        });
    });

    it('returns gateway support for openrouter-format reasoning models', () => {
        expect(getReasoningSupport('openrouter', 'anthropic/claude-3.7-sonnet')).toEqual({
            capable: true,
            supportedPresets: ['off', 'low', 'medium', 'high'],
            supportsBudgetTokens: true,
        });
    });

    it('returns gateway support for dexto-nova provider (OpenRouter-format IDs)', () => {
        expect(getReasoningSupport('dexto-nova', 'openai/gpt-5.2-codex')).toEqual({
            capable: true,
            supportedPresets: ['off', 'low', 'medium', 'high'],
            supportsBudgetTokens: true,
        });
    });

    it('does not expose OpenRouter tuning presets for excluded model families', () => {
        expect(getReasoningSupport('openrouter', 'deepseek/deepseek-r1:free')).toEqual({
            capable: false,
            supportedPresets: ['off'],
            supportsBudgetTokens: false,
        });
    });
});
