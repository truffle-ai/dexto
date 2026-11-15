import { describe, expect, it } from 'vitest';
import { APICallError, UnsupportedFunctionalityError } from 'ai';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { LLMErrorCode } from '../error-codes.js';
import { HostRetryableModelRequestError, mapProviderError } from './provider-error.js';

describe('mapProviderError', () => {
    it('tells a Dexto gateway user to sign in again on a 401, without a retry', () => {
        const mapped = mapProviderError({
            error: new APICallError({
                message: 'Authentication required.',
                statusCode: 401,
                responseHeaders: {},
                responseBody:
                    '{"error":{"code":"credential_expired","message":"Sign in again (dexto login) or create a new API key."}}',
                url: 'https://app.dexto.ai/v1/chat/completions',
                requestBodyValues: {},
            }),
            provider: 'dexto-nova',
            model: 'openai/gpt-5.4',
            sessionId: 'session-401',
        });

        expect(mapped).toBeInstanceOf(DextoRuntimeError);
        expect(mapped).toMatchObject({
            code: LLMErrorCode.AUTH_FAILED,
            retryDisposition: 'non_retryable',
        });
        expect(mapped.message).toContain('dexto login');
        expect(mapped).toMatchObject({ recovery: expect.stringContaining('dexto login') });
    });

    it('keeps a 401 the host can renew retryable instead of asking the user to sign in', () => {
        const mapped = mapProviderError({
            error: new HostRetryableModelRequestError({
                message: 'Host classified model request failure as retryable',
                statusCode: 401,
                responseHeaders: {},
                responseBody: '{"error":{"code":"credential_expired","message":"expired"}}',
                url: 'https://app.dexto.ai/v1/chat/completions',
                requestBodyValues: {},
                isRetryable: true,
            }),
            provider: 'dexto-nova',
            model: 'openai/gpt-5.4',
            sessionId: 'session-401-host',
        });

        expect(mapped).toMatchObject({
            code: LLMErrorCode.GENERATION_FAILED,
            retryDisposition: 'retryable',
        });
        expect(mapped.message).not.toContain('dexto login');
    });

    it('names the provider and its key on a 401 from any other provider', () => {
        const mapped = mapProviderError({
            error: new APICallError({
                message: 'Incorrect API key provided',
                statusCode: 401,
                responseHeaders: {},
                responseBody: '{"error":{"message":"Incorrect API key provided"}}',
                url: 'https://api.openai.com/v1/chat/completions',
                requestBodyValues: {},
            }),
            provider: 'openai',
            model: 'gpt-5.4',
            sessionId: 'session-401-openai',
        });

        expect(mapped).toMatchObject({
            code: LLMErrorCode.AUTH_FAILED,
            retryDisposition: 'non_retryable',
        });
        expect(mapped.message).toContain('openai');
        expect(mapped.message).not.toContain('dexto login');
    });

    it('does not retry deterministic unsupported functionality failures', () => {
        const mapped = mapProviderError({
            error: new UnsupportedFunctionalityError({
                functionality: 'file part media type application/pdf',
            }),
            provider: 'dexto-nova',
            model: 'openai/gpt-5.4',
            sessionId: 'session-pdf',
        });

        expect(mapped).toBeInstanceOf(DextoRuntimeError);
        expect(mapped).toMatchObject({
            code: LLMErrorCode.GENERATION_FAILED,
            retryDisposition: 'non_retryable',
        });
    });

    it('preserves structured stream error messages from provider adapters', () => {
        const mapped = mapProviderError({
            error: {
                code: 'invalid_request_error',
                message: "Invalid schema for function 'lookup': schema must have type 'object'.",
            },
            provider: 'dexto-nova',
            model: 'openai/gpt-5.4',
            sessionId: 'session-tools',
        });

        expect(mapped).toBeInstanceOf(DextoRuntimeError);
        expect(mapped).toMatchObject({
            code: LLMErrorCode.REQUEST_INVALID_SCHEMA,
            message: "Invalid schema for function 'lookup': schema must have type 'object'.",
            retryDisposition: 'non_retryable',
        });
    });

    it('marks insufficient credits provider failures as non-retryable', () => {
        const error = new APICallError({
            message: 'Payment Required',
            statusCode: 402,
            responseHeaders: {},
            responseBody: JSON.stringify({
                error: {
                    message: 'Insufficient credits. Balance: $-57.26.',
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
            sessionId: 'session-credits',
        });

        expect(mapped).toBeInstanceOf(DextoRuntimeError);
        expect(mapped.message).toBe('Insufficient Dexto credits. Balance: $-57.26');
        expect(mapped).toMatchObject({
            code: LLMErrorCode.INSUFFICIENT_CREDITS,
            retryDisposition: 'non_retryable',
        });
    });

    it('marks retryable provider failures as retryable', () => {
        const error = new APICallError({
            message: 'Rate limited',
            statusCode: 429,
            responseHeaders: {},
            responseBody: 'Rate limited',
            url: 'https://api.openai.com/v1/responses',
            requestBodyValues: {},
            isRetryable: true,
        });

        const mapped = mapProviderError({
            error,
            provider: 'openai',
            model: 'gpt-5-mini',
            sessionId: 'session-rate-limit',
        });

        expect(mapped).toBeInstanceOf(DextoRuntimeError);
        expect(mapped).toMatchObject({
            code: LLMErrorCode.RATE_LIMIT_EXCEEDED,
            retryDisposition: 'retryable',
        });
    });

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
            retryDisposition: 'non_retryable',
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
        expect(mapped.message).toBe('Plain provider failure');
        expect(mapped).toMatchObject({
            code: LLMErrorCode.GENERATION_FAILED,
            context: expect.objectContaining({
                model: 'gpt-4.1',
                provider: 'openai',
                sessionId: 'session-2',
            }),
        });
    });
});
