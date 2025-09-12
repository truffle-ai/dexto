import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpClient } from '../src/http-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('HttpClient', () => {
    let client: HttpClient;

    beforeEach(() => {
        vi.resetAllMocks();
        client = new HttpClient({
            baseUrl: 'https://api.example.com',
            timeout: 5000,
            retries: 2,
        });
    });

    describe('Constructor', () => {
        it('should create client with valid config', () => {
            const config = {
                baseUrl: 'https://api.example.com',
                apiKey: 'test-key',
                timeout: 10000,
                retries: 3,
            };

            const httpClient = new HttpClient(config);
            expect(httpClient).toBeInstanceOf(HttpClient);
        });

        it('should throw error for invalid baseUrl on first request', async () => {
            const invalidConfig = {
                baseUrl: 'not-a-url',
            };

            const httpClient = new HttpClient(invalidConfig as any);
            await expect(httpClient.get('/test')).rejects.toThrow(TypeError);
        });
    });

    describe('GET requests', () => {
        it('should make successful GET request', async () => {
            const responseData = { message: 'success' };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve(responseData),
                headers: new Map([['content-type', 'application/json']]),
            });

            const result = await client.get('/test');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.example.com/test',
                expect.objectContaining({
                    method: 'GET',
                    headers: {},
                    signal: expect.any(AbortSignal),
                })
            );
            expect(result).toEqual(responseData);
        });

        it('should include API key in headers when provided', async () => {
            const clientWithKey = new HttpClient({
                baseUrl: 'https://api.example.com',
                apiKey: 'test-key',
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({}),
                headers: new Map([['content-type', 'application/json']]),
            });

            await clientWithKey.get('/test');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.example.com/test',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer test-key',
                    }),
                })
            );
        });

        it('should handle 204 No Content responses', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 204,
                headers: new Map([['content-length', '0']]),
            });

            const result = await client.get('/test');
            expect(result).toEqual({});
        });

        it('should throw ClientError for HTTP errors', async () => {
            const errorData = { error: 'Not found' };
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: () => Promise.resolve(errorData),
            });

            await expect(client.get('/test')).rejects.toThrow();
        });

        it('should throw timeout error on AbortError', async () => {
            const abortError = new Error('Request timeout');
            abortError.name = 'AbortError';
            mockFetch.mockRejectedValueOnce(abortError);

            await expect(client.get('/test')).rejects.toThrow();
        });
    });

    describe('POST requests', () => {
        it('should make successful POST request with body', async () => {
            const requestData = { name: 'test' };
            const responseData = { id: 1, name: 'test' };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve(responseData),
                headers: new Map([['content-type', 'application/json']]),
            });

            const result = await client.post('/users', requestData);

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.example.com/users',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify(requestData),
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                    }),
                })
            );
            expect(result).toEqual(responseData);
        });

        it('should make POST request without body', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({}),
                headers: new Map([['content-type', 'application/json']]),
            });

            await client.post('/action');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.example.com/action',
                expect.objectContaining({
                    method: 'POST',
                })
            );

            const callArgs = mockFetch.mock.calls[0]?.[1];
            expect(callArgs?.body).toBeUndefined();
        });
    });

    describe('PUT requests', () => {
        it('should make successful PUT request', async () => {
            const requestData = { name: 'updated' };
            const responseData = { id: 1, name: 'updated' };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve(responseData),
                headers: new Map([['content-type', 'application/json']]),
            });

            const result = await client.put('/users/1', requestData);

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.example.com/users/1',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify(requestData),
                })
            );
            expect(result).toEqual(responseData);
        });
    });

    describe('DELETE requests', () => {
        it('should make successful DELETE request', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 204,
                headers: new Map(),
            });

            const result = await client.delete('/users/1');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.example.com/users/1',
                expect.objectContaining({
                    method: 'DELETE',
                })
            );
            expect(result).toEqual({});
        });
    });

    describe('Retry logic', () => {
        it('should retry on transient errors', async () => {
            // First call fails with 503
            mockFetch
                .mockResolvedValueOnce({
                    ok: false,
                    status: 503,
                    statusText: 'Service Unavailable',
                    json: () => Promise.resolve({}),
                    headers: new Map(),
                })
                // Second call succeeds
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ success: true }),
                    headers: new Map([['content-type', 'application/json']]),
                });

            const result = await client.get('/test');
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(result).toEqual({ success: true });
        });

        it('should respect Retry-After header', async () => {
            vi.useFakeTimers();
            try {
                mockFetch
                    .mockResolvedValueOnce({
                        ok: false,
                        status: 429,
                        statusText: 'Too Many Requests',
                        json: () => Promise.resolve({}),
                        headers: new Map([['retry-after', '2']]),
                    })
                    .mockResolvedValueOnce({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({ success: true }),
                        headers: new Map([['content-type', 'application/json']]),
                    });

                const promise = client.get('/test');
                // First request should have been issued immediately
                expect(mockFetch).toHaveBeenCalledTimes(1);

                // Advance timers by the Retry-After duration (2 seconds)
                await vi.advanceTimersByTimeAsync(2000);

                const result = await promise;
                expect(mockFetch).toHaveBeenCalledTimes(2);
                expect(result).toEqual({ success: true });
            } finally {
                vi.useRealTimers();
            }
        });

        it('should not retry on non-transient errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: () => Promise.resolve({ error: 'Invalid input' }),
            });

            await expect(client.get('/test')).rejects.toThrow();
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should give up after max retries', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                json: () => Promise.resolve({}),
            });

            await expect(client.get('/test')).rejects.toThrow();
            // Should be called initial attempt + 2 retries = 3 times
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });
    });

    describe('Error handling', () => {
        it('should handle network errors', async () => {
            const networkError = new Error('Network error');
            mockFetch.mockRejectedValueOnce(networkError);

            await expect(client.get('/test')).rejects.toThrow();
        });

        it('should handle JSON parse errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.reject(new Error('Invalid JSON')),
                text: () => Promise.resolve('invalid json'),
                headers: new Map([['content-type', 'application/json']]),
            });

            await expect(client.get('/test')).rejects.toThrow();
        });
    });
});
