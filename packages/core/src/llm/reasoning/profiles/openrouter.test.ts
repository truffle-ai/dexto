import { describe, expect, it } from 'vitest';
import { getOpenRouterReasoningTarget, isOpenRouterGatewayProvider } from './openrouter.js';

describe('openrouter reasoning profile routing', () => {
    describe('isOpenRouterGatewayProvider', () => {
        it('returns true for gateway providers', () => {
            expect(isOpenRouterGatewayProvider('openrouter')).toBe(true);
            expect(isOpenRouterGatewayProvider('dexto-nova')).toBe(true);
        });

        it('returns false for non-gateway providers', () => {
            expect(isOpenRouterGatewayProvider('openai')).toBe(false);
            expect(isOpenRouterGatewayProvider('anthropic')).toBe(false);
            expect(isOpenRouterGatewayProvider('google')).toBe(false);
        });
    });

    describe('getOpenRouterReasoningTarget', () => {
        it('maps OpenAI-family models', () => {
            expect(getOpenRouterReasoningTarget('openai/gpt-5.2-codex')).toEqual({
                upstreamProvider: 'openai',
                modelId: 'gpt-5.2-codex',
            });
        });

        it('maps Anthropic-family models', () => {
            expect(getOpenRouterReasoningTarget('anthropic/claude-opus-4.6')).toEqual({
                upstreamProvider: 'anthropic',
                modelId: 'claude-opus-4.6',
            });
        });

        it('maps only Gemini-3 Google models', () => {
            expect(getOpenRouterReasoningTarget('google/gemini-3-pro-preview')).toEqual({
                upstreamProvider: 'google',
                modelId: 'gemini-3-pro-preview',
            });
            expect(getOpenRouterReasoningTarget('google/gemini-2.5-pro')).toBeNull();
        });

        it('rejects excluded model families', () => {
            expect(getOpenRouterReasoningTarget('deepseek/deepseek-r1:free')).toBeNull();
            expect(getOpenRouterReasoningTarget('minimax/minimax-m2.1')).toBeNull();
            expect(getOpenRouterReasoningTarget('z-ai/glm-4.7')).toBeNull();
            expect(getOpenRouterReasoningTarget('mistralai/mistral-medium-3.1')).toBeNull();
            expect(getOpenRouterReasoningTarget('moonshotai/kimi-k2.5')).toBeNull();
            expect(getOpenRouterReasoningTarget('moonshotai/kimi-k2p5')).toBeNull();
        });

        it('rejects malformed and unknown-prefix IDs', () => {
            expect(getOpenRouterReasoningTarget('gpt-5.2')).toBeNull();
            expect(getOpenRouterReasoningTarget('x-ai/grok-4')).toBeNull();
            expect(getOpenRouterReasoningTarget('cohere/command-a')).toBeNull();
        });
    });
});
