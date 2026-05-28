import { describe, expect, it } from 'vitest';
import {
    getAuthMethodDefinition,
    getProviderAuthDefinition,
    getProviderAuthDefinitions,
    isExternalAccountAuthMethod,
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
            ['chatgpt_login', 'external_account'],
        ]);
        expect(getProviderAuthDefinitions()).toHaveLength(1);
    });

    it('does not expose ChatGPT Login as a separate Codex provider', () => {
        expect(getProviderAuthDefinition('codex')).toBeNull();
        expect(getProviderAuthDefinition('openai-codex')).toBeNull();
    });

    it('projects ChatGPT Login credentials to internal Codex runtime auth', () => {
        const method = getAuthMethodDefinition('openai', 'chatgpt_login');

        expect(method).not.toBeNull();
        if (!method || !isExternalAccountAuthMethod(method)) {
            throw new Error('Expected ChatGPT Login to be an external account auth method');
        }

        expect(
            method.externalAccount.resolveRuntimeAuth({
                credential: {
                    type: 'external_account',
                    system: 'codex',
                    authMode: 'chatgpt',
                },
            })
        ).toEqual({ baseURL: 'codex://chatgpt' });
    });
});
