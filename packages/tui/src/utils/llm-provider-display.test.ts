import { describe, expect, it } from 'vitest';
import { getLLMProviderDisplayName } from './llm-provider-display.js';

describe('getLLMProviderDisplayName', () => {
    it('shows ChatGPT-backed Codex configs distinctly', () => {
        expect(getLLMProviderDisplayName('openai-compatible', 'codex://chatgpt')).toBe(
            'via ChatGPT'
        );
    });

    it('falls back to generic openai-compatible labeling for standard endpoints', () => {
        expect(getLLMProviderDisplayName('openai-compatible', 'https://example.com/v1')).toBe(
            'OpenAI-Compatible'
        );
    });
});
