import { describe, expect, it } from 'vitest';
import { getReasoningProfile, supportsReasoningVariant } from './profile.js';

describe('getReasoningProfile', () => {
    it('returns non-capable profile for non-reasoning models', () => {
        expect(getReasoningProfile('openai', 'gpt-4o-mini')).toEqual({
            capable: false,
            paradigm: 'none',
            variants: [],
            supportedVariants: [],
            supportsBudgetTokens: false,
        });
    });

    it('returns exact OpenAI native efforts', () => {
        const profile = getReasoningProfile('openai', 'gpt-5.2-codex');
        expect(profile.capable).toBe(true);
        expect(profile.paradigm).toBe('effort');
        expect(profile.supportedVariants).toEqual(['low', 'medium', 'high', 'xhigh']);
        expect(profile.defaultVariant).toBe('medium');
    });

    it('returns Anthropic budget profile for pre-adaptive models', () => {
        expect(getReasoningProfile('anthropic', 'claude-3-7-sonnet-20250219')).toMatchObject({
            capable: true,
            paradigm: 'budget',
            supportedVariants: ['disabled', 'enabled'],
            defaultVariant: 'enabled',
            supportsBudgetTokens: true,
        });
    });

    it('returns Anthropic adaptive profile for Claude >= 4.6', () => {
        expect(getReasoningProfile('anthropic', 'claude-sonnet-4-6')).toMatchObject({
            capable: true,
            paradigm: 'adaptive-effort',
            supportedVariants: ['disabled', 'low', 'medium', 'high'],
            defaultVariant: 'medium',
            supportsBudgetTokens: false,
        });
    });

    it('includes max for Anthropic Opus adaptive models', () => {
        expect(getReasoningProfile('anthropic', 'claude-opus-4-6')).toMatchObject({
            capable: true,
            paradigm: 'adaptive-effort',
            supportedVariants: ['disabled', 'low', 'medium', 'high', 'max'],
        });
    });

    it('returns Gemini 3 thinking-level profile', () => {
        expect(getReasoningProfile('google', 'gemini-3-flash-preview')).toMatchObject({
            capable: true,
            paradigm: 'thinking-level',
            supportedVariants: ['disabled', 'minimal', 'low', 'medium', 'high'],
            defaultVariant: 'medium',
            supportsBudgetTokens: false,
        });
    });

    it('returns Gemini 2.5 budget profile', () => {
        expect(getReasoningProfile('google', 'gemini-2.5-pro')).toMatchObject({
            capable: true,
            paradigm: 'budget',
            supportedVariants: ['disabled', 'enabled'],
            defaultVariant: 'enabled',
            supportsBudgetTokens: true,
        });
    });

    it('returns OpenRouter OpenAI-native effort profile', () => {
        expect(getReasoningProfile('openrouter', 'openai/gpt-5.2-codex')).toMatchObject({
            capable: true,
            paradigm: 'effort',
            supportedVariants: ['low', 'medium', 'high', 'xhigh'],
            defaultVariant: 'medium',
            supportsBudgetTokens: true,
        });
    });

    it('returns OpenRouter Anthropic-native profile based on model generation', () => {
        expect(getReasoningProfile('openrouter', 'anthropic/claude-sonnet-4.5')).toMatchObject({
            capable: true,
            paradigm: 'budget',
            supportedVariants: ['enabled'],
            defaultVariant: 'enabled',
            supportsBudgetTokens: true,
        });

        expect(getReasoningProfile('openrouter', 'anthropic/claude-sonnet-4.6')).toMatchObject({
            capable: true,
            paradigm: 'adaptive-effort',
            supportedVariants: ['low', 'medium', 'high'],
            defaultVariant: 'medium',
            supportsBudgetTokens: true,
        });
    });

    it('returns OpenRouter Gemini-3 thinking-level profile', () => {
        expect(getReasoningProfile('openrouter', 'google/gemini-3-pro-preview')).toMatchObject({
            capable: true,
            paradigm: 'thinking-level',
            supportedVariants: ['minimal', 'low', 'medium', 'high'],
            defaultVariant: 'medium',
            supportsBudgetTokens: true,
        });
    });

    it('returns non-capable profile for OpenRouter excluded families', () => {
        expect(getReasoningProfile('openrouter', 'deepseek/deepseek-r1:free')).toEqual({
            capable: false,
            paradigm: 'none',
            variants: [],
            supportedVariants: [],
            supportsBudgetTokens: false,
        });
    });
});

describe('supportsReasoningVariant', () => {
    it('checks membership against profile variants', () => {
        const profile = getReasoningProfile('vertex', 'gemini-3-flash-preview');
        expect(supportsReasoningVariant(profile, 'medium')).toBe(true);
        expect(supportsReasoningVariant(profile, 'xhigh')).toBe(false);
    });
});
