import { describe, it, expect } from 'vitest';
import { ClientError } from '../src/errors.js';

describe('ClientError Factory', () => {
    describe('Connection and Network Errors', () => {
        it('should create connection failed error', () => {
            const baseUrl = 'http://localhost:3000';
            const originalError = new Error('Connection refused');

            const error = ClientError.connectionFailed(baseUrl, originalError);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ConnectionError');
            expect(error.message).toBe(`Failed to connect to Dexto server at ${baseUrl}`);
            expect((error as any).baseUrl).toBe(baseUrl);
            expect((error as any).originalError).toBe(originalError.message);
        });

        it('should create network error', () => {
            const message = 'Network unreachable';
            const originalError = new Error('ENOTFOUND');

            const error = ClientError.networkError(message, originalError);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('NetworkError');
            expect(error.message).toBe(`Network error: ${message}`);
            expect((error as any).originalError).toBe(originalError.message);
        });

        it('should create HTTP error with correct error type for 4xx status', () => {
            const error = ClientError.httpError(400, 'Bad Request', '/api/test', {
                field: 'invalid',
            });

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('HttpError');
            expect(error.message).toBe('HTTP 400: Bad Request (/api/test)');
            expect((error as any).status).toBe(400);
            expect((error as any).statusText).toBe('Bad Request');
            expect((error as any).endpoint).toBe('/api/test');
            expect((error as any).details).toEqual({ field: 'invalid' });
        });

        it('should create HTTP error with correct error type for 5xx status', () => {
            const error = ClientError.httpError(500, 'Internal Server Error');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('HttpError');
            expect(error.message).toBe('HTTP 500: Internal Server Error');
            expect((error as any).status).toBe(500);
        });

        it('should create HTTP error with rate limit type for 429 status', () => {
            const error = ClientError.httpError(429, 'Too Many Requests');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('HttpError');
            expect(error.message).toBe('HTTP 429: Too Many Requests');
            expect((error as any).status).toBe(429);
        });

        it('should create timeout error', () => {
            const operation = 'sendMessage';
            const timeout = 5000;

            const error = ClientError.timeoutError(operation, timeout);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('TimeoutError');
            expect(error.message).toBe(`Operation '${operation}' timed out after ${timeout}ms`);
            expect((error as any).operation).toBe(operation);
            expect((error as any).timeout).toBe(timeout);
        });
    });

    describe('WebSocket Errors', () => {
        it('should create WebSocket connection failed error', () => {
            const url = 'ws://localhost:3000/';
            const originalError = new Error('Connection refused');

            const error = ClientError.websocketConnectionFailed(url, originalError);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('WebSocketConnectionError');
            expect(error.message).toBe(`Failed to connect WebSocket to ${url}`);
            expect((error as any).url).toBe(url);
            expect((error as any).originalError).toBe(originalError.message);
        });

        it('should create WebSocket send failed error', () => {
            const originalError = new Error('Connection closed');

            const error = ClientError.websocketSendFailed(originalError);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('WebSocketSendError');
            expect(error.message).toBe('Failed to send WebSocket message');
            expect((error as any).originalError).toBe(originalError.message);
        });
    });

    describe('Configuration Errors', () => {
        it('should create invalid config error', () => {
            const field = 'apiKey';
            const value = '';
            const reason = 'API key cannot be empty';

            const error = ClientError.invalidConfig(field, value, reason);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('InvalidConfigError');
            expect(error.message).toBe(`Invalid configuration for ${field}: ${reason}`);
            expect((error as any).field).toBe(field);
            expect((error as any).value).toBe(value);
            expect((error as any).reason).toBe(reason);
        });

        it('should create response parse error', () => {
            const originalError = new Error('Unexpected token');

            const error = ClientError.responseParseError(originalError);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ResponseParseError');
            expect(error.message).toBe('Failed to parse server response');
            expect((error as any).originalError).toBe(originalError.message);
        });
    });
});
