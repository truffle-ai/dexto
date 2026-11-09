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
