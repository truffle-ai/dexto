import { describe, it, expect } from 'vitest';
import { ClientError, DextoRuntimeError, DextoValidationError } from '../src/errors.js';
import { ErrorScope, ErrorType } from '@dexto/core';

describe('ClientError Factory', () => {
    describe('Connection and Network Errors', () => {
        it('should create connection failed error', () => {
            const baseUrl = 'http://localhost:3000';
            const originalError = new Error('Connection refused');

            const error = ClientError.connectionFailed(baseUrl, originalError);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('agent_initialization_failed');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.THIRD_PARTY);
            expect(error.message).toBe(`Failed to connect to Dexto server at ${baseUrl}`);
            expect(error.context).toEqual({
                baseUrl,
                originalError: 'Connection refused',
            });
            expect(error.recovery).toBe(
                'Check that the Dexto server is running and the baseUrl is correct'
            );
        });

        it('should create network error', () => {
            const message = 'Network unreachable';
            const originalError = new Error('ENOTFOUND');

            const error = ClientError.networkError(message, originalError);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('mcp_connection_failed');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.THIRD_PARTY);
            expect(error.message).toBe(message);
            expect(error.context).toEqual({
                originalError: 'ENOTFOUND',
            });
        });

        it('should create HTTP error with correct error type for 4xx status', () => {
            const error = ClientError.httpError(400, 'Bad Request', '/api/test', {
                detail: 'Invalid input',
            });

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('mcp_connection_failed');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.USER);
            expect(error.message).toBe('HTTP 400: Bad Request (/api/test)');
            expect(error.context).toEqual({
                status: 400,
                statusText: 'Bad Request',
                endpoint: '/api/test',
                details: { detail: 'Invalid input' },
            });
        });

        it('should create HTTP error with correct error type for 5xx status', () => {
            const error = ClientError.httpError(500, 'Internal Server Error');

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.type).toBe(ErrorType.THIRD_PARTY);
            expect(error.message).toBe('HTTP 500: Internal Server Error');
            expect(error.recovery).toBe('Server error - try again later');
        });

        it('should create HTTP error with rate limit type for 429 status', () => {
            const error = ClientError.httpError(429, 'Too Many Requests');

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.type).toBe(ErrorType.RATE_LIMIT);
        });

        it('should create timeout error', () => {
            const operation = 'fetchUser';
            const timeout = 5000;

            const error = ClientError.timeoutError(operation, timeout);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('mcp_connection_failed');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.TIMEOUT);
            expect(error.message).toBe(`Operation '${operation}' timed out after ${timeout}ms`);
            expect(error.context).toEqual({ operation, timeout });
        });
    });

    describe('WebSocket Errors', () => {
        it('should create WebSocket connection failed error', () => {
            const url = 'ws://localhost:3000/ws';
            const originalError = new Error('Connection failed');

            const error = ClientError.websocketConnectionFailed(url, originalError);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('mcp_connection_failed');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.THIRD_PARTY);
            expect(error.message).toBe(`Failed to connect WebSocket to ${url}`);
            expect(error.context).toEqual({
                url,
                originalError: 'Connection failed',
            });
        });

        it('should create WebSocket send failed error', () => {
            const originalError = new Error('Connection closed');

            const error = ClientError.websocketSendFailed(originalError);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('mcp_connection_failed');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.SYSTEM);
            expect(error.message).toBe('Failed to send WebSocket message');
        });
    });

    describe('Validation Errors', () => {
        it('should create validation failed error with issues', () => {
            const issues = [
                {
                    code: 'agent_api_validation_error' as any,
                    message: 'Field is required',
                    scope: ErrorScope.AGENT,
                    type: ErrorType.USER,
                    severity: 'error' as const,
                    path: ['user', 'name'],
                },
            ];

            const error = ClientError.validationFailed(issues);

            expect(error).toBeInstanceOf(DextoValidationError);
            expect(error.issues).toEqual(issues);
        });

        it('should create invalid config error', () => {
            const field = 'baseUrl';
            const value = 'invalid-url';
            const reason = 'Must be a valid URL';

            const error = ClientError.invalidConfig(field, value, reason);

            expect(error).toBeInstanceOf(DextoValidationError);
            expect(error.issues).toHaveLength(1);
            expect(error.issues[0]).toEqual({
                code: 'agent_api_validation_error',
                message: `Invalid configuration for ${field}: ${reason}`,
                scope: ErrorScope.CONFIG,
                type: ErrorType.USER,
                severity: 'error',
                context: { field, value },
            });
        });

        it('should create response parse error', () => {
            const originalError = new Error('Invalid JSON');

            const error = ClientError.responseParseError(originalError);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('agent_api_validation_error');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.THIRD_PARTY);
            expect(error.message).toBe('Failed to parse server response');
            expect(error.context).toEqual({
                originalError: 'Invalid JSON',
            });
        });
    });

    describe('Authentication Errors', () => {
        it('should create authentication failed error', () => {
            const details = { reason: 'Invalid API key' };

            const error = ClientError.authenticationFailed(details);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('agent_api_validation_error');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.USER);
            expect(error.message).toBe('Authentication failed');
            expect(error.context).toEqual({ details });
        });

        it('should create unauthorized error', () => {
            const error = ClientError.unauthorized();

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('agent_api_validation_error');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.FORBIDDEN);
            expect(error.message).toBe('Unauthorized access');
        });

        it('should create rate limited error with retry after', () => {
            const retryAfter = 60;

            const error = ClientError.rateLimited(retryAfter);

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe('agent_api_validation_error');
            expect(error.scope).toBe(ErrorScope.AGENT);
            expect(error.type).toBe(ErrorType.RATE_LIMIT);
            expect(error.message).toBe('Rate limit exceeded');
            expect(error.context).toEqual({ retryAfter });
            expect(error.recovery).toBe(`Wait ${retryAfter} seconds before retrying`);
        });

        it('should create rate limited error without retry after', () => {
            const error = ClientError.rateLimited();

            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.recovery).toBe('Wait before making more requests');
        });
    });
});
