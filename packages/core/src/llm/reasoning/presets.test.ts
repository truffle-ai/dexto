import { describe, expect, it } from 'vitest';
import { getReasoningSupport } from './presets.js';

describe('getReasoningSupport', () => {
    it('returns only auto/off for non-reasoning models', () => {
        expect(getReasoningSupport('openai', 'gpt-4o-mini')).toEqual({
            capable: false,
            supportedPresets: ['auto', 'off'],
            supportsBudgetTokens: false,
        });
    });

    it('returns openai presets for reasoning-capable models', () => {
        expect(getReasoningSupport('openai', 'gpt-5')).toEqual({
            capable: true,
            supportedPresets: ['auto', 'off', 'low', 'medium', 'high', 'max'],
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
            supportedPresets: ['auto', 'off', 'low', 'medium', 'high', 'max'],
            supportsBudgetTokens: true,
        });
    });

    it('returns gateway support for openrouter-format reasoning models', () => {
        expect(getReasoningSupport('openrouter', 'anthropic/claude-3.7-sonnet')).toEqual({
            capable: true,
            supportedPresets: ['auto', 'off', 'low', 'medium', 'high', 'max'],
            supportsBudgetTokens: true,
        });
    });

    it('returns gateway support for dexto provider (OpenRouter-format IDs)', () => {
        expect(getReasoningSupport('dexto', 'openai/gpt-5.2-codex')).toEqual({
            capable: true,
            supportedPresets: ['auto', 'off', 'low', 'medium', 'high', 'max', 'xhigh'],
            supportsBudgetTokens: true,
        });
    });
});
