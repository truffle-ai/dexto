import { describe, expect, it } from 'vitest';
import { DextoValidationError } from '../../errors/DextoValidationError.js';
import { buildModelsByProviderFromParsedSources, parseModelsDevApi } from './sync.js';

type FixtureModelOverrides = Partial<{
    reasoning: boolean;
    temperature: boolean;
    tool_call: boolean;
    release_date: string;
    status: string;
    interleaved: true | { field: string };
    provider: { npm?: string; api?: string };
    modalities: {
        input: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
        output: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
    };
    cost: {
        input: number;
        output: number;
        cache_read?: number;
        cache_write?: number;
        reasoning?: number;
        input_audio?: number;
        output_audio?: number;
        context_over_200k?: { input: number; output: number };
    };
}>;

function buildFixtureModel(
    id: string,
    name: string,
    overrides?: FixtureModelOverrides
): Record<string, unknown> {
    return {
        id,
        name,
        attachment: false,
        reasoning: overrides?.reasoning ?? true,
        temperature: overrides?.temperature ?? true,
        tool_call: overrides?.tool_call ?? true,
        release_date: overrides?.release_date ?? '2026-01-01',
        ...(overrides?.status ? { status: overrides.status } : {}),
        ...(overrides?.interleaved ? { interleaved: overrides.interleaved } : {}),
        ...(overrides?.provider ? { provider: overrides.provider } : {}),
        limit: {
            context: 200000,
            input: 200000,
            output: 16000,
        },
        modalities: overrides?.modalities ?? {
            input: ['text'],
            output: ['text'],
        },
        cost: overrides?.cost ?? {
            input: 1,
            output: 2,
        },
    };
}

function buildFixtureApi(overrides?: {
    openaiModelOverrides?: FixtureModelOverrides;
}): Record<string, unknown> {
    return {
        openai: {
            id: 'openai',
            name: 'OpenAI',
            env: ['OPENAI_API_KEY'],
            npm: '@ai-sdk/openai',
            doc: 'https://platform.openai.com/docs',
            models: {
                'gpt-5-mini': buildFixtureModel(
                    'gpt-5-mini',
                    'GPT-5 Mini',
                    overrides?.openaiModelOverrides
                ),
            },
        },
        anthropic: {
            id: 'anthropic',
            name: 'Anthropic',
            env: ['ANTHROPIC_API_KEY'],
            npm: '@ai-sdk/anthropic',
            doc: 'https://docs.anthropic.com',
            models: {
                'claude-sonnet-4-5-20250929': buildFixtureModel(
                    'claude-sonnet-4-5-20250929',
                    'Claude Sonnet 4.5'
                ),
            },
        },
        google: {
            id: 'google',
            name: 'Google',
            env: ['GOOGLE_GENERATIVE_AI_API_KEY'],
            npm: '@ai-sdk/google',
            doc: 'https://ai.google.dev',
            models: {
                'gemini-3-flash-preview': buildFixtureModel(
                    'gemini-3-flash-preview',
                    'Gemini 3 Flash Preview'
                ),
            },
        },
        groq: {
            id: 'groq',
            name: 'Groq',
            env: ['GROQ_API_KEY'],
            npm: '@ai-sdk/groq',
            doc: 'https://console.groq.com/docs',
            models: {
                'llama-3.3-70b-versatile': buildFixtureModel(
                    'llama-3.3-70b-versatile',
                    'Llama 3.3 70B'
                ),
            },
        },
        xai: {
            id: 'xai',
            name: 'xAI',
            env: ['XAI_API_KEY'],
            npm: '@ai-sdk/xai',
            doc: 'https://docs.x.ai',
            models: {
                'grok-4': buildFixtureModel('grok-4', 'Grok 4'),
            },
        },
        cohere: {
            id: 'cohere',
            name: 'Cohere',
            env: ['COHERE_API_KEY'],
            npm: '@ai-sdk/cohere',
            doc: 'https://docs.cohere.com',
            models: {
                'command-a-03-2025': buildFixtureModel('command-a-03-2025', 'Command A'),
            },
        },
        minimax: {
            id: 'minimax',
            name: 'MiniMax',
            env: ['MINIMAX_API_KEY'],
            npm: '@ai-sdk/openai-compatible',
            doc: 'https://platform.minimax.io',
            models: {
                'MiniMax-M2.1': buildFixtureModel('MiniMax-M2.1', 'MiniMax M2.1'),
            },
        },
        zhipuai: {
            id: 'zhipuai',
            name: 'ZhipuAI',
            env: ['ZHIPUAI_API_KEY'],
            npm: '@ai-sdk/openai-compatible',
            doc: 'https://open.bigmodel.cn',
            models: {
                'glm-4.7': buildFixtureModel('glm-4.7', 'GLM 4.7'),
            },
        },
        'google-vertex': {
            id: 'google-vertex',
            name: 'Vertex',
            env: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION'],
            npm: '@ai-sdk/google-vertex',
            doc: 'https://cloud.google.com/vertex-ai',
            models: {
                'gemini-3-flash-preview': buildFixtureModel(
                    'gemini-3-flash-preview',
                    'Gemini 3 Flash Preview'
                ),
            },
        },
        'google-vertex-anthropic': {
            id: 'google-vertex-anthropic',
            name: 'Vertex Anthropic',
            env: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION'],
            npm: '@ai-sdk/google-vertex/anthropic',
            doc: 'https://cloud.google.com/vertex-ai',
            models: {
                'claude-sonnet-4-5-20250929': buildFixtureModel(
                    'claude-sonnet-4-5-20250929',
                    'Claude Sonnet 4.5'
                ),
            },
        },
        'amazon-bedrock': {
            id: 'amazon-bedrock',
            name: 'Bedrock',
            env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
            npm: '@ai-sdk/amazon-bedrock',
            doc: 'https://docs.aws.amazon.com/bedrock',
            models: {
                'anthropic.claude-sonnet-4-5-20250929-v1:0': buildFixtureModel(
                    'anthropic.claude-sonnet-4-5-20250929-v1:0',
                    'Claude Sonnet 4.5'
                ),
            },
        },
        openrouter: {
            id: 'openrouter',
            name: 'OpenRouter',
            env: ['OPENROUTER_API_KEY'],
            npm: '@openrouter/ai-sdk-provider',
            doc: 'https://openrouter.ai/docs',
            models: {
                'openai/gpt-5-mini': buildFixtureModel('openai/gpt-5-mini', 'GPT-5 Mini'),
            },
        },
    };
}

describe('models.dev sync mapping', () => {
    it('maps additional model metadata fields from models.dev', () => {
        const parsed = parseModelsDevApi(
            buildFixtureApi({
                openaiModelOverrides: {
                    status: 'deprecated',
                    interleaved: { field: 'reasoning_content' },
                    provider: { npm: '@ai-sdk/openai', api: 'https://api.openai.com/v1' },
                    modalities: { input: ['text', 'image'], output: ['text'] },
                    cost: {
                        input: 1,
                        output: 2,
                        cache_read: 0.1,
                        cache_write: 0.5,
                        reasoning: 3,
                        input_audio: 4,
                        output_audio: 5,
                        context_over_200k: { input: 6, output: 7 },
                    },
                },
            })
        );

        const modelsByProvider = buildModelsByProviderFromParsedSources({ modelsDevApi: parsed });
        const model = modelsByProvider.openai.find((entry) => entry.name === 'gpt-5-mini');

        expect(model).toBeDefined();
        expect(model?.supportsToolCall).toBe(true);
        expect(model?.releaseDate).toBe('2026-01-01');
        expect(model?.status).toBe('deprecated');
        expect(model?.modalities).toEqual({ input: ['text', 'image'], output: ['text'] });
        expect(model?.providerMetadata).toEqual({
            npm: '@ai-sdk/openai',
            api: 'https://api.openai.com/v1',
        });
        expect(model?.supportsInterleaved).toBe(true);
        expect(model?.interleaved).toEqual({ field: 'reasoning_content' });
        expect(model?.pricing).toEqual({
            inputPerM: 1,
            outputPerM: 2,
            cacheReadPerM: 0.1,
            cacheWritePerM: 0.5,
            reasoningPerM: 3,
            inputAudioPerM: 4,
            outputAudioPerM: 5,
            contextOver200kPerM: {
                inputPerM: 6,
                outputPerM: 7,
            },
            currency: 'USD',
            unit: 'per_million_tokens',
        });
    });

    it('fails validation when required capability metadata is missing', () => {
        const fixture = buildFixtureApi();
        const openaiModels = (fixture.openai as { models: Record<string, Record<string, unknown>> })
            .models;
        const gpt5Mini = openaiModels['gpt-5-mini'];
        if (gpt5Mini) {
            delete gpt5Mini.reasoning;
        }
        const parsed = parseModelsDevApi(fixture);

        expect(() =>
            buildModelsByProviderFromParsedSources({
                modelsDevApi: parsed,
            })
        ).toThrowError(DextoValidationError);
    });
});
