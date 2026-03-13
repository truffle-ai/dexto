import { describe, expect, it } from 'vitest';
import {
    createCodexBaseURL,
    getCodexAuthModeLabel,
    getCodexProviderDisplayName,
    isCodexBaseURL,
    parseCodexBaseURL,
} from './codex-base-url.js';

describe('codex base URL helpers', () => {
    it('creates and parses a ChatGPT Codex base URL', () => {
        const baseURL = createCodexBaseURL('chatgpt');

        expect(baseURL).toBe('codex://chatgpt');
        expect(parseCodexBaseURL(baseURL)).toEqual({ authMode: 'chatgpt' });
        expect(isCodexBaseURL(baseURL)).toBe(true);
    });

    it('parses codex URLs without an explicit auth mode as auto', () => {
        expect(parseCodexBaseURL('codex://')).toEqual({ authMode: 'auto' });
        expect(parseCodexBaseURL('codex:///auto')).toEqual({ authMode: 'auto' });
    });

    it('rejects non-codex URLs', () => {
        expect(parseCodexBaseURL('https://example.com/v1')).toBeNull();
        expect(isCodexBaseURL('https://example.com/v1')).toBe(false);
    });

    it('formats display labels for Codex auth modes', () => {
        expect(getCodexAuthModeLabel('chatgpt')).toBe('ChatGPT');
        expect(getCodexProviderDisplayName('chatgpt')).toBe('ChatGPT Login');
        expect(getCodexProviderDisplayName('apikey')).toBe('ChatGPT Login (API key)');
        expect(getCodexProviderDisplayName()).toBe('ChatGPT Login');
    });
});
