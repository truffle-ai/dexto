import { describe, expect, it } from 'vitest';
import {
    formatProviderLabel,
    getProviderSelectOptions,
    getSupportedProviderIdsFromCatalog,
} from './provider-select';

describe('provider-select helpers', () => {
    describe('formatProviderLabel', () => {
        it('uses explicit labels for known providers', () => {
            expect(formatProviderLabel('openai')).toBe('OpenAI');
            expect(formatProviderLabel('dexto-nova')).toBe('Dexto Nova');
            expect(formatProviderLabel('google-vertex-anthropic')).toBe('Google Vertex Anthropic');
        });

        it('falls back to title-casing unknown providers', () => {
            expect(formatProviderLabel('moonshotai-cn')).toBe('Moonshotai Cn');
        });
    });

    describe('getSupportedProviderIdsFromCatalog', () => {
        it('returns only known provider ids from grouped catalog payloads', () => {
            expect(
                getSupportedProviderIdsFromCatalog({
                    providers: {
                        anthropic: {},
                        openai: {},
                        'future-provider': {},
                    },
                })
            ).toEqual(['anthropic', 'openai']);
        });

        it('returns an empty list for non-grouped payloads', () => {
            expect(getSupportedProviderIdsFromCatalog({ models: [] })).toEqual([]);
        });
    });

    describe('getProviderSelectOptions', () => {
        it('sorts supported providers by label', () => {
            expect(
                getProviderSelectOptions({
                    supportedProviders: ['openai', 'dexto-nova', 'anthropic'],
                })
            ).toEqual([
                { value: 'anthropic', label: 'Anthropic', isUnsupported: false },
                { value: 'dexto-nova', label: 'Dexto Nova', isUnsupported: false },
                { value: 'openai', label: 'OpenAI', isUnsupported: false },
            ]);
        });

        it('keeps the current unsupported provider visible as a temporary option', () => {
            expect(
                getProviderSelectOptions({
                    supportedProviders: ['anthropic', 'openai'],
                    currentProvider: 'moonshotai',
                })
            ).toEqual([
                {
                    value: 'moonshotai',
                    label: 'Moonshotai (Unsupported)',
                    isUnsupported: true,
                },
                { value: 'anthropic', label: 'Anthropic', isUnsupported: false },
                { value: 'openai', label: 'OpenAI', isUnsupported: false },
            ]);
        });

        it('does not duplicate the current provider when it is already supported', () => {
            expect(
                getProviderSelectOptions({
                    supportedProviders: ['anthropic', 'openai'],
                    currentProvider: 'openai',
                })
            ).toEqual([
                { value: 'anthropic', label: 'Anthropic', isUnsupported: false },
                { value: 'openai', label: 'OpenAI', isUnsupported: false },
            ]);
        });
    });
});
