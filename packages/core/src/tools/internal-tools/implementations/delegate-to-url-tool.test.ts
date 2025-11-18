import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createDelegateToUrlTool } from './delegate-to-url-tool.js';
import { DextoRuntimeError } from '../../../errors/DextoRuntimeError.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('delegate_to_url tool', () => {
    let tool: ReturnType<typeof createDelegateToUrlTool>;

    beforeEach(() => {
        tool = createDelegateToUrlTool();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Tool Definition', () => {
        it('should have correct tool metadata', () => {
            expect(tool.id).toBe('delegate_to_url');
            expect(tool.description).toBeDefined();
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.inputSchema).toBeDefined();
        });

        it('should have required input schema fields', () => {
            const schema = tool.inputSchema as any; // Zod schema shape checking
            expect(schema.shape.url).toBeDefined();
            expect(schema.shape.message).toBeDefined();
            expect(schema.shape.sessionId).toBeDefined();
            expect(schema.shape.timeout).toBeDefined();
        });
    });

    describe('Input Validation', () => {
        it('should accept valid input', () => {
            const validInput = {
                url: 'http://localhost:3001',
                message: 'Test message',
            };

            const result = tool.inputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
        });

        it('should reject invalid URL', () => {
            const invalidInput = {
                url: 'not-a-url',
                message: 'Test message',
            };

            const result = tool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });

        it('should reject empty message', () => {
            const invalidInput = {
                url: 'http://localhost:3001',
                message: '',
            };

            const result = tool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });

        it('should accept optional sessionId', () => {
            const validInput = {
                url: 'http://localhost:3001',
                message: 'Test message',
                sessionId: 'session-123',
            };

            const result = tool.inputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.sessionId).toBe('session-123');
            }
        });

        it('should set default timeout', () => {
            const input = {
                url: 'http://localhost:3001',
                message: 'Test message',
            };

            const result = tool.inputSchema.safeParse(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.timeout).toBe(30000);
            }
        });
    });

    describe('Successful Delegation', () => {
        it('should delegate message and return response', async () => {
            // Mock successful A2A response
            const mockResponse = {
                jsonrpc: '2.0',
                id: 'test-id',
                result: {
                    id: 'task-123',
                    contextId: 'context-123',
                    status: {
                        state: 'completed',
                    },
                    history: [
                        {
                            role: 'user',
                            parts: [{ kind: 'text', text: 'Test message' }],
                        },
                        {
                            role: 'agent',
                            parts: [{ kind: 'text', text: 'Response from delegated agent' }],
                        },
                    ],
                    kind: 'task',
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            });

            const result = (await tool.execute({
                url: 'http://localhost:3001',
                message: 'Test message',
            })) as any;

            expect(result.success).toBe(true);
            expect(result.agentUrl).toBe('http://localhost:3001');
            expect(result.response).toBe('Response from delegated agent');
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should include sessionId in response when provided', async () => {
            const mockResponse = {
                jsonrpc: '2.0',
                id: 'test-id',
                result: {
                    id: 'task-123',
                    contextId: 'context-123',
                    status: { state: 'completed' },
                    history: [
                        {
                            role: 'agent',
                            parts: [{ kind: 'text', text: 'Response' }],
                        },
                    ],
                    kind: 'task',
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            });

            const result = (await tool.execute({
                url: 'http://localhost:3001',
                message: 'Test message',
                sessionId: 'session-456',
            })) as any;

            expect(result.sessionId).toBe('session-456');
        });

        it('should try multiple endpoints', async () => {
            // First endpoint fails
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });

            // Second endpoint succeeds
            const mockResponse = {
                jsonrpc: '2.0',
                id: 'test-id',
                result: {
                    id: 'task-123',
                    history: [
                        {
                            role: 'agent',
                            parts: [{ kind: 'text', text: 'Success' }],
                        },
                    ],
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            });

            const result = (await tool.execute({
                url: 'http://localhost:3001',
                message: 'Test message',
            })) as any;

            expect(result.success).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('Error Handling', () => {
        it('should throw DextoRuntimeError on timeout', async () => {
            // Mock fetch to simulate AbortError (what fetch does when aborted)
            mockFetch.mockRejectedValue(
                Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
            );

            await expect(
                tool.execute({
                    url: 'http://localhost:3001',
                    message: 'Test message',
                    timeout: 100, // Very short timeout
                })
            ).rejects.toThrow(DextoRuntimeError);
        });

        it('should throw DextoRuntimeError when all endpoints fail', async () => {
            // All endpoints return errors
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });

            await expect(
                tool.execute({
                    url: 'http://localhost:3001',
                    message: 'Test message',
                })
            ).rejects.toThrow(DextoRuntimeError);

            // Should try both endpoints
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('should handle JSON-RPC error responses', async () => {
            const errorResponse = {
                jsonrpc: '2.0',
                id: 'test-id',
                error: {
                    code: -32603,
                    message: 'Internal error',
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => errorResponse,
            });

            // Should fail on first endpoint with error, try second endpoint
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });

            // Expect DextoRuntimeError to be thrown (error gets caught and retried on other endpoints)
            await expect(
                tool.execute({
                    url: 'http://localhost:3001',
                    message: 'Test message',
                })
            ).rejects.toThrow(DextoRuntimeError);
        });

        it('should handle network errors', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));

            await expect(
                tool.execute({
                    url: 'http://localhost:3001',
                    message: 'Test message',
                })
            ).rejects.toThrow(DextoRuntimeError);
        });
    });

    describe('URL Handling', () => {
        it('should handle URLs with trailing slash', async () => {
            const mockResponse = {
                jsonrpc: '2.0',
                id: 'test-id',
                result: {
                    history: [
                        {
                            role: 'agent',
                            parts: [{ kind: 'text', text: 'Success' }],
                        },
                    ],
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            });

            await tool.execute({
                url: 'http://localhost:3001/',
                message: 'Test message',
            });

            // Check that fetch was called with correct endpoint (no double slash)
            const fetchCall = mockFetch.mock.calls[0]?.[0];
            expect(fetchCall).not.toContain('//v1');
            expect(fetchCall).toContain('/v1/jsonrpc');
        });

        it('should construct correct endpoint URLs', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    jsonrpc: '2.0',
                    result: {
                        history: [{ role: 'agent', parts: [{ kind: 'text', text: 'ok' }] }],
                    },
                }),
            });

            await tool.execute({
                url: 'http://localhost:3001',
                message: 'Test',
            });

            const firstCall = mockFetch.mock.calls[0]?.[0];
            expect(firstCall).toBe('http://localhost:3001/v1/jsonrpc');
        });
    });
});
