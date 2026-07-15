import { TextEncoder } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    LanguageModelV2,
    LanguageModelV2FilePart,
    SharedV2ProviderOptions,
} from '@ai-sdk/provider';
import { LLMConfigSchema } from '../schemas.js';
import { createVercelModel } from './factory.js';

function isLanguageModelV2(value: unknown): value is LanguageModelV2 {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof Reflect.get(value, 'doGenerate') === 'function'
    );
}

async function captureGatewayRequest(
    file: LanguageModelV2FilePart,
    providerOptions: SharedV2ProviderOptions | undefined
): Promise<unknown> {
    let request: unknown;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
            request = JSON.parse(String(init?.body));
            return Response.json({
                choices: [
                    {
                        finish_reason: 'stop',
                        index: 0,
                        message: { content: 'ok', role: 'assistant' },
                    },
                ],
                created: 1,
                id: 'chatcmpl_file_test',
                model: 'openai/gpt-5.4',
                object: 'chat.completion',
                usage: {
                    completion_tokens: 1,
                    prompt_tokens: 1,
                    total_tokens: 2,
                },
            });
        })
    );

    const model = await createVercelModel(
        LLMConfigSchema.parse({
            apiKey: 'dxt_test_key',
            baseURL: 'https://gateway.example/v1',
            model: 'openai/gpt-5.4',
            provider: 'dexto-nova',
        })
    );
    if (!isLanguageModelV2(model)) {
        throw new Error('Expected dexto-nova to create an AI SDK language model.');
    }

    await model.doGenerate({
        prompt: [
            {
                content: [{ text: 'Analyze this file.', type: 'text' }, file],
                role: 'user',
            },
        ],
        ...(providerOptions === undefined ? {} : { providerOptions }),
    });

    return request;
}

describe('createVercelModel dexto-nova file transport', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        {
            filename: 'test.pdf',
            mediaType: 'application/pdf',
            payload: '%PDF-test',
        },
        {
            filename: 'test.docx',
            mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            payload: 'PK-docx-test',
        },
    ])('sends $mediaType file parts to the Dexto gateway', async (file) => {
        const request = await captureGatewayRequest(
            {
                data: new TextEncoder().encode(file.payload),
                filename: file.filename,
                mediaType: file.mediaType,
                type: 'file',
            },
            undefined
        );

        expect(request).toEqual(
            expect.objectContaining({
                messages: [
                    {
                        content: [
                            { text: 'Analyze this file.', type: 'text' },
                            {
                                file: {
                                    file_data: expect.stringMatching(
                                        new RegExp(`^data:${file.mediaType};base64,`, 'u')
                                    ),
                                    filename: file.filename,
                                },
                                type: 'file',
                            },
                        ],
                        role: 'user',
                    },
                ],
            })
        );
    });

    it('sends audio file parts to the Dexto gateway', async () => {
        const request = await captureGatewayRequest(
            {
                data: new TextEncoder().encode('mp3-test'),
                filename: 'test.mp3',
                mediaType: 'audio/mp3',
                type: 'file',
            },
            undefined
        );

        expect(request).toEqual(
            expect.objectContaining({
                messages: [
                    {
                        content: [
                            { text: 'Analyze this file.', type: 'text' },
                            {
                                input_audio: {
                                    data: expect.any(String),
                                    format: 'mp3',
                                },
                                type: 'input_audio',
                            },
                        ],
                        role: 'user',
                    },
                ],
            })
        );
    });

    it('preserves Nova reasoning options in the serialized gateway request', async () => {
        const request = await captureGatewayRequest(
            {
                data: new TextEncoder().encode('%PDF-test'),
                filename: 'test.pdf',
                mediaType: 'application/pdf',
                type: 'file',
            },
            {
                openrouter: {
                    include_reasoning: true,
                    reasoning: { effort: 'high', enabled: true },
                },
            }
        );

        expect(request).toEqual(
            expect.objectContaining({
                include_reasoning: true,
                reasoning: {
                    effort: 'high',
                    enabled: true,
                },
            })
        );
    });
});
