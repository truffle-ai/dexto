import { describe, expect, it } from 'vitest';
import { inferProviderRuntimeMetadata } from './provider-runtime.js';

describe('inferProviderRuntimeMetadata', () => {
    it('maps representative providers across the phase 1 runtime families', () => {
        expect(
            inferProviderRuntimeMetadata({
                providerId: 'openai',
                npm: '@ai-sdk/openai',
            })
        ).toEqual({
            family: 'openai-responses',
            category: 'direct',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'groq',
                npm: '@ai-sdk/groq',
            })
        ).toEqual({
            family: 'openai-completions',
            category: 'direct',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'anthropic',
                npm: '@ai-sdk/anthropic',
            })
        ).toEqual({
            family: 'anthropic-messages',
            category: 'direct',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'google',
                npm: '@ai-sdk/google',
            })
        ).toEqual({
            family: 'google-generative-ai',
            category: 'direct',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'google-vertex',
                npm: '@ai-sdk/google-vertex',
            })
        ).toEqual({
            family: 'google-vertex',
            category: 'cloud',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'google-vertex-anthropic',
                npm: '@ai-sdk/google-vertex/anthropic',
            })
        ).toEqual({
            family: 'google-vertex-anthropic',
            category: 'cloud',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'amazon-bedrock',
                npm: '@ai-sdk/amazon-bedrock',
            })
        ).toEqual({
            family: 'bedrock-converse-stream',
            category: 'cloud',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'openrouter',
                npm: '@openrouter/ai-sdk-provider',
            })
        ).toEqual({
            family: 'openrouter',
            category: 'gateway',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'cohere',
                npm: '@ai-sdk/cohere',
            })
        ).toEqual({
            family: 'cohere',
            category: 'direct',
        });
    });

    it('keeps special providers on their intended runtime families', () => {
        expect(
            inferProviderRuntimeMetadata({
                providerId: 'dexto-nova',
                npm: '@ai-sdk/openai-compatible',
            })
        ).toEqual({
            family: 'openrouter',
            category: 'gateway',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'local',
                npm: '@ai-sdk/openai-compatible',
            })
        ).toEqual({
            family: 'local-native',
            category: 'local',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'openai-compatible',
                npm: '@ai-sdk/openai-compatible',
            })
        ).toEqual({
            family: 'openai-completions',
            category: 'self-hosted',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'ollama',
                npm: '@ai-sdk/openai-compatible',
                api: 'http://localhost:11434/v1',
            })
        ).toEqual({
            family: 'openai-completions',
            category: 'local',
        });

        expect(
            inferProviderRuntimeMetadata({
                providerId: 'glama',
                npm: '@ai-sdk/openai-compatible',
                api: 'https://glama.ai/api/gateway/openai/v1',
            })
        ).toEqual({
            family: 'openai-completions',
            category: 'gateway',
        });
    });

    it('returns undefined when no phase 1 runtime mapping exists', () => {
        expect(
            inferProviderRuntimeMetadata({
                providerId: 'azure',
                npm: '@ai-sdk/azure',
            })
        ).toBeUndefined();
    });
});
