import { APICallError, generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { LLMConfigSchema } from '../schemas.js';
import { createVercelModel } from './factory.js';

describe('runtime request provenance', () => {
    it('passes the failed request provenance to the host and preserves its retry decision through the SDK', async () => {
        const seen: string[] = [];
        const model = await createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai-compatible',
                model: 'test',
                apiKey: 'test',
                baseURL: 'https://example.test/v1',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        requestAuth: {
                            fetch: async () => ({
                                response: new Response(
                                    '{"error":{"code":"credential_expired","message":"expired"}}',
                                    { status: 401 }
                                ),
                                provenance: 'attempt-one',
                            }),
                            isRetryableResponse: async ({ provenance }) => {
                                seen.push(String(provenance));
                                return true;
                            },
                        },
                    }),
                },
            }
        );
        let error: unknown;
        try {
            await generateText({ model, prompt: 'hello', maxRetries: 0 });
        } catch (caught) {
            error = caught;
        }
        expect(seen).toEqual(['attempt-one']);
        expect(APICallError.isInstance(error)).toBe(true);
        expect(error).toMatchObject({ statusCode: 401, isRetryable: true });
    });
    it('leaves a host-declined failure non-retryable', async () => {
        const model = await createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai-compatible',
                model: 'test',
                apiKey: 'test',
                baseURL: 'https://example.test/v1',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        requestAuth: {
                            fetch: async () => ({
                                response: new Response('{"error":{"message":"expired"}}', {
                                    status: 401,
                                }),
                                provenance: 'current',
                            }),
                            isRetryableResponse: async () => false,
                        },
                    }),
                },
            }
        );
        let error: unknown;
        try {
            await generateText({ model, prompt: 'hello', maxRetries: 0 });
        } catch (caught) {
            error = caught;
        }
        expect(APICallError.isInstance(error)).toBe(true);
        expect(error).toMatchObject({ statusCode: 401, isRetryable: false });
    });
});

describe('request authentication across providers', () => {
    it.each([
        ['openrouter', 'openai/gpt-4o'],
        ['google', 'gemini-2.5-flash'],
        ['groq', 'llama-3.3-70b-versatile'],
        ['xai', 'grok-4.3'],
        ['cohere', 'command-r-08-2024'],
    ] as const)('classifies failures for %s', async (provider, modelId) => {
        let classified = false;
        const model = await createVercelModel(
            LLMConfigSchema.parse({ provider, model: modelId, apiKey: 'test' }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        requestAuth: {
                            fetch: async () => ({
                                response: new Response('error', { status: 401 }),
                                provenance: 'sent',
                            }),
                            isRetryableResponse: async () => {
                                classified = true;
                                return true;
                            },
                        },
                    }),
                },
            }
        );
        await expect(generateText({ model, prompt: 'hello', maxRetries: 0 })).rejects.toMatchObject(
            { statusCode: 401, isRetryable: true }
        );
        expect(classified).toBe(true);
    });

    it('does not classify successful responses', async () => {
        let classified = false;
        const model = await createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai-compatible',
                model: 'test',
                apiKey: 'test',
                baseURL: 'https://example.test/v1',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        requestAuth: {
                            fetch: async () => ({
                                response: Response.json({
                                    id: '1',
                                    choices: [
                                        {
                                            message: { role: 'assistant', content: 'ok' },
                                            finish_reason: 'stop',
                                        },
                                    ],
                                }),
                                provenance: null,
                            }),
                            isRetryableResponse: async () => {
                                classified = true;
                                return true;
                            },
                        },
                    }),
                },
            }
        );
        await generateText({ model, prompt: 'hello', maxRetries: 0 });
        expect(classified).toBe(false);
    });
});

describe('retry error handling', () => {
    async function run(response: Response, classify: () => Promise<boolean>) {
        const model = await createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai-compatible',
                model: 'test',
                apiKey: 'test',
                baseURL: 'https://example.test/v1',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        requestAuth: {
                            fetch: async () => ({ response, provenance: null }),
                            isRetryableResponse: classify,
                        },
                    }),
                },
            }
        );
        return generateText({ model, prompt: 'hello', maxRetries: 0 });
    }
    it('bounds the classifier view and preserves a declined original response', async () => {
        let classifiedBody = '';
        const response = new Response('x'.repeat(100_000), { status: 401 });
        const model = await createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai-compatible',
                model: 'test',
                apiKey: 'test',
                baseURL: 'https://example.test/v1',
            }),
            {
                authResolver: {
                    resolveRuntimeAuth: () => ({
                        requestAuth: {
                            fetch: async () => ({ response, provenance: null }),
                            isRetryableResponse: async ({ response: view }) => {
                                classifiedBody = await view.text();
                                return false;
                            },
                        },
                    }),
                },
            }
        );
        await expect(generateText({ model, prompt: 'hello', maxRetries: 0 })).rejects.toMatchObject(
            { statusCode: 401, isRetryable: false, responseBody: 'x'.repeat(100_000) }
        );
        expect(classifiedBody).toHaveLength(65536);
    });
    it('keeps the SDK error when classification throws', async () => {
        await expect(
            run(Response.json({ error: { message: 'denied' } }, { status: 401 }), async () => {
                throw new Error('classifier');
            })
        ).rejects.toMatchObject({ statusCode: 401, isRetryable: false });
    });
    it('preserves cancellation from the classifier', async () => {
        await expect(
            run(new Response('x', { status: 401 }), async () => {
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('retains retryability when reading a response fails', async () => {
        const response = new Response(
            new globalThis.ReadableStream({
                start(controller) {
                    controller.error(new Error('broken'));
                },
            }),
            { status: 401 }
        );
        await expect(run(response, async () => true)).rejects.toMatchObject({
            statusCode: 401,
            isRetryable: true,
            responseBody: '',
        });
    });
    it('caps the retryable response body at 64 KiB', async () => {
        await expect(
            run(new Response('x'.repeat(100_000), { status: 401 }), async () => true)
        ).rejects.toMatchObject({
            statusCode: 401,
            isRetryable: true,
            responseBody: 'x'.repeat(65536),
        });
    });
    it('rejects conflicting runtime fetch settings', async () => {
        await expect(
            createVercelModel(
                LLMConfigSchema.parse({
                    provider: 'openai-compatible',
                    model: 'test',
                    apiKey: 'test',
                    baseURL: 'https://example.test/v1',
                }),
                {
                    authResolver: {
                        resolveRuntimeAuth: () => ({
                            fetch: globalThis.fetch,
                            requestAuth: {
                                fetch: async () => ({ response: new Response(), provenance: null }),
                                isRetryableResponse: async () => false,
                            },
                        }),
                    },
                }
            )
        ).rejects.toThrow('both fetch and requestAuth');
    });
});
