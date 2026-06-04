import { describe, expect, it } from 'vitest';
import { APICallError } from 'ai';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { LLMErrorCode } from '../error-codes.js';
import { mapProviderError } from './provider-error.js';

describe('mapProviderError', () => {
    it('does not classify generic OpenRouter 400 responses as invalid schema errors', () => {
        const error = new APICallError({
            message: 'Bad Request',
            statusCode: 400,
            responseHeaders: {},
            responseBody: JSON.stringify({
                error: {
                    code: 400,
                    message: 'Provider returned error',
                },
            }),
            url: 'https://openrouter.ai/api/v1/chat/completions',
            requestBodyValues: {},
            isRetryable: false,
        });

        const mapped = mapProviderError({
            error,
            provider: 'openrouter',
            model: 'openai/gpt-5.4-mini',
            sessionId: 'session-1',
        });

        expect(mapped).toBeInstanceOf(DextoRuntimeError);
        expect(mapped).toMatchObject({
            code: LLMErrorCode.GENERATION_FAILED,
            context: expect.objectContaining({
                model: 'openai/gpt-5.4-mini',
                openRouterErrorCode: 400,
                provider: 'openrouter',
                sessionId: 'session-1',
                statusCode: 400,
            }),
        });
    });

    it('wraps plain provider failures in the typed LLM error pipeline', () => {
        const mapped = mapProviderError({
            error: new Error('Plain provider failure'),
            provider: 'openai',
            model: 'gpt-4.1',
            sessionId: 'session-2',
        });

        expect(mapped).toBeInstanceOf(DextoRuntimeError);
        expect(mapped).toMatchObject({
            code: LLMErrorCode.GENERATION_FAILED,
            message: 'Plain provider failure',
            context: expect.objectContaining({
                model: 'gpt-4.1',
                provider: 'openai',
                sessionId: 'session-2',
            }),
        });
    });
});
