import { describe, expect, it } from 'vitest';
import {
    getOpenRouterCandidateModelIds,
    isOpenRouterGatewayProvider,
    resolveGatewayModelOrigin,
} from './model-origin.js';

describe('model-origin helpers', () => {
    describe('isOpenRouterGatewayProvider', () => {
        it('returns true only for OpenRouter-style gateway providers', () => {
            expect(isOpenRouterGatewayProvider('openrouter')).toBe(true);
            expect(isOpenRouterGatewayProvider('dexto-nova')).toBe(true);
            expect(isOpenRouterGatewayProvider('openai')).toBe(false);
        });
    });

    describe('resolveGatewayModelOrigin', () => {
        it('reuses OpenAI and Anthropic native semantics for both gateways', () => {
            const cases = [
                {
                    provider: 'openrouter' as const,
                    model: 'openai/gpt-5.2-codex',
                    expected: { upstreamProvider: 'openai', upstreamModelId: 'gpt-5.2-codex' },
                },
                {
                    provider: 'dexto-nova' as const,
                    model: 'anthropic/claude-opus-4.6',
                    expected: {
                        upstreamProvider: 'anthropic',
                        upstreamModelId: 'claude-opus-4.6',
                    },
                },
            ];

            for (const entry of cases) {
                expect(resolveGatewayModelOrigin(entry.provider, entry.model)).toEqual(
                    entry.expected
                );
            }
        });

        it('maps only Gemini-3 Google models', () => {
            expect(resolveGatewayModelOrigin('openrouter', 'google/gemini-3-pro-preview')).toEqual({
                upstreamProvider: 'google',
                upstreamModelId: 'gemini-3-pro-preview',
            });
            expect(resolveGatewayModelOrigin('openrouter', 'google/gemini-2.5-pro')).toBeNull();
        });

        it('returns null for unknown or excluded gateway mappings', () => {
            expect(resolveGatewayModelOrigin('openrouter', 'deepseek/deepseek-r1:free')).toBeNull();
            expect(resolveGatewayModelOrigin('openrouter', 'x-ai/grok-4')).toBeNull();
            expect(resolveGatewayModelOrigin('openrouter', 'gpt-5.2')).toBeNull();
        });
    });

    describe('getOpenRouterCandidateModelIds', () => {
        it('generates Anthropic dotted and no-date candidates first', () => {
            expect(
                getOpenRouterCandidateModelIds('claude-haiku-4-5-20251001', 'anthropic')
            ).toEqual([
                'anthropic/claude-haiku-4.5',
                'anthropic/claude-haiku-4-5',
                'anthropic/claude-haiku-4-5-20251001',
            ]);
        });

        it('generates both Google base and -001 candidates', () => {
            expect(getOpenRouterCandidateModelIds('gemini-2.0-flash', 'google')).toEqual([
                'google/gemini-2.0-flash',
                'google/gemini-2.0-flash-001',
            ]);
        });
    });
});
