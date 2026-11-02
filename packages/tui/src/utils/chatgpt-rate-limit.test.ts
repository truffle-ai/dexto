import { describe, expect, it } from 'vitest';
import { createCodexBaseURL } from '@dexto/core';
import {
    getChatGPTRateLimitHint,
    resolveChatGPTRateLimitHint,
    resolveChatGPTFallbackModel,
    shouldShowChatGPTRateLimitHint,
} from './chatgpt-rate-limit.js';

describe('chatgpt-rate-limit utils', () => {
    it('shows footer hints when ChatGPT usage is approaching the cap', () => {
        expect(
            shouldShowChatGPTRateLimitHint({
                source: 'chatgpt-login',
                usedPercent: 82,
                exceeded: false,
            })
        ).toBe(true);
        expect(
            getChatGPTRateLimitHint({
                source: 'chatgpt-login',
                usedPercent: 82,
                exceeded: false,
            })
        ).toBe('ChatGPT cap 82% used');
    });

    it('gives a short form for tight status lines, and nothing for other providers', () => {
        const chatgpt = { provider: 'openai-compatible', baseURL: createCodexBaseURL('chatgpt') };
        const near = { source: 'chatgpt-login' as const, usedPercent: 95, exceeded: false };
        const capped = { source: 'chatgpt-login' as const, usedPercent: 100, exceeded: true };
        expect(resolveChatGPTRateLimitHint(chatgpt, near, 'short')).toBe('cap 95%');
        expect(resolveChatGPTRateLimitHint(chatgpt, capped, 'short')).toBe('cap reached');
        expect(resolveChatGPTRateLimitHint(chatgpt, near, 'full')).toBe('ChatGPT cap 95% used');
        expect(resolveChatGPTRateLimitHint({ provider: 'openai' }, near, 'short')).toBeNull();
    });

    it('formats a hard cap state without showing fake reset data', () => {
        expect(
            getChatGPTRateLimitHint({
                source: 'chatgpt-login',
                usedPercent: 100,
                exceeded: true,
            })
        ).toBe('ChatGPT cap reached');
    });

    it('keeps the same model when it is available via the OpenAI API', () => {
        expect(resolveChatGPTFallbackModel('gpt-5')).toEqual({
            provider: 'openai',
            model: 'gpt-5',
            displayName: 'GPT-5',
            usedDefaultFallback: false,
        });
    });

    it('falls back to the default OpenAI model when the ChatGPT model is not available', () => {
        expect(resolveChatGPTFallbackModel('nonexistent-chatgpt-model')).toEqual({
            provider: 'openai',
            model: 'gpt-5-mini',
            displayName: 'GPT-5 Mini',
            usedDefaultFallback: true,
        });
    });
});
