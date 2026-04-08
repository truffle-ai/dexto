import { describe, expect, it } from 'vitest';
import { getSupportedProviders } from '@dexto/core';

import { getConnectProvider } from './connect-catalog.js';
import {
    PROVIDER_AUTH_DEFINITIONS,
    getAuthMethodDefinition,
    getAuthMethodDefinitionForProfile,
    getProviderAuthDefinition,
    isOauthAuthMethod,
} from './provider-auth-definitions.js';

describe('provider auth definitions', () => {
    it('keeps openai oauth and api_key methods available through the definition layer', () => {
        const provider = getProviderAuthDefinition('openai');

        expect(provider?.methods.map((method) => [method.id, method.kind])).toEqual([
            ['oauth_codex', 'oauth'],
            ['api_key', 'api_key'],
        ]);

        const oauthMethod = getAuthMethodDefinition('openai', 'oauth_codex');
        expect(oauthMethod).not.toBeNull();
        expect(oauthMethod && isOauthAuthMethod(oauthMethod)).toBe(true);

        if (!oauthMethod || !isOauthAuthMethod(oauthMethod)) {
            throw new Error('Expected openai oauth method to be present');
        }

        expect(typeof oauthMethod.oauth.start).toBe('function');
        expect(typeof oauthMethod.oauth.refresh).toBe('function');
        expect(typeof oauthMethod.oauth.resolveRuntimeAuth).toBe('function');
    });

    it('keeps lightweight token and guidance methods free of oauth hooks', () => {
        const anthropicToken = getAuthMethodDefinition('anthropic', 'setup_token');
        expect(anthropicToken).toEqual({
            id: 'setup_token',
            label: 'Setup token (subscription)',
            kind: 'token',
        });

        const vertexGuidance = getAuthMethodDefinition('google-vertex', 'guidance');
        expect(vertexGuidance).toEqual({
            id: 'guidance',
            label: 'Guided setup',
            kind: 'guidance',
            hint: 'Use Application Default Credentials (gcloud auth application-default login)',
        });

        expect(anthropicToken && isOauthAuthMethod(anthropicToken)).toBe(false);
        expect(vertexGuidance && isOauthAuthMethod(vertexGuidance)).toBe(false);
        expect(anthropicToken && 'oauth' in anthropicToken).toBe(false);
        expect(vertexGuidance && 'oauth' in vertexGuidance).toBe(false);
    });

    it('resolves stored provider and method ids back to the shared definition', () => {
        const method = getAuthMethodDefinitionForProfile({
            providerId: 'minimax-cn-coding-plan',
            methodId: 'portal_oauth_cn',
        });

        expect(method).toEqual({
            id: 'portal_oauth_cn',
            label: 'MiniMax Portal OAuth (CN)',
            kind: 'oauth',
            oauth: expect.objectContaining({
                start: expect.any(Function),
                refresh: expect.any(Function),
                resolveRuntimeAuth: expect.any(Function),
            }),
        });
    });

    it('derives the connect catalog from the shared provider definitions', () => {
        expect(getConnectProvider('litellm')).toEqual({
            providerId: 'litellm',
            label: 'LiteLLM',
            modelsDevProviderId: 'litellm',
            methods: [
                {
                    id: 'guidance',
                    label: 'Guided setup',
                    kind: 'guidance',
                    hint: 'Set base URL and API key for your LiteLLM proxy',
                },
            ],
        });
    });

    it('only exposes auth definitions for runtime-supported providers', () => {
        const supportedProviders = new Set<string>(getSupportedProviders());

        expect(
            PROVIDER_AUTH_DEFINITIONS.every((provider) =>
                supportedProviders.has(provider.providerId)
            )
        ).toBe(true);
    });
});
