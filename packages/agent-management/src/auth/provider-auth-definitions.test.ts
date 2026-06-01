import { describe, expect, it } from 'vitest';
import {
    getAuthMethodDefinition,
    getProviderAuthDefinition,
    getProviderAuthDefinitions,
    isOAuthAuthMethod,
} from './provider-auth-definitions.js';

describe('provider auth definitions', () => {
    it('exposes API key and ChatGPT Login as OpenAI auth methods', () => {
        const provider = getProviderAuthDefinition('openai');

        expect(provider).toMatchObject({
            providerId: 'openai',
            label: 'OpenAI',
        });
        expect(provider?.methods.map((method) => [method.id, method.kind])).toEqual([
            ['api_key', 'api_key'],
            ['chatgpt_login', 'oauth'],
        ]);
        expect(getProviderAuthDefinitions()).toHaveLength(1);
    });

    it('does not expose ChatGPT Login as a separate Codex provider', () => {
        expect(getProviderAuthDefinition('codex')).toBeNull();
        expect(getProviderAuthDefinition('openai-codex')).toBeNull();
    });

    it('models ChatGPT Login as an OpenAI OAuth method', () => {
        const method = getAuthMethodDefinition('openai', 'chatgpt_login');

        expect(method).not.toBeNull();
        if (!method || !isOAuthAuthMethod(method)) {
            throw new Error('Expected ChatGPT Login to be an OAuth auth method');
        }
    });
});
