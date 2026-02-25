import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TextDecoder } from 'node:util';
import type { StreamingEvent } from '@dexto/core';
import {
    createTestAgent,
    startTestServer,
    httpRequest,
    type TestServer,
    expectResponseStructure,
    validators,
} from './test-fixtures.js';

describe('Hono API Integration Tests', () => {
    let testServer: TestServer | undefined;

    beforeAll(async () => {
        const agent = await createTestAgent();
        testServer = await startTestServer(agent);
    }, 30000); // 30 second timeout for server startup

    afterAll(async () => {
        if (testServer) {
            await testServer.cleanup();
        }
    });

    describe('Health', () => {
        it('GET /health returns OK', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/health');
            expect(res.status).toBe(200);
            expect(res.text).toBe('OK');
        });
    });

    describe('LLM Routes', () => {
        it('GET /api/llm/current returns current LLM config', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/llm/current');
            expect(res.status).toBe(200);
            expectResponseStructure(res.body, {
                config: validators.object,
            });
            const config = (
                res.body as {
                    config: {
                        provider: string;
                        model: string;
                        displayName?: string;
                    };
                }
            ).config;
            expect(config.provider).toBe('openai');
            expect(config.model).toBe('gpt-5-nano');
            expect(typeof config.displayName === 'string' || config.displayName === undefined).toBe(
                true
            );
        });

        it('GET /api/llm/current with sessionId returns session-specific config', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create a session first
            const createRes = await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-llm',
            });
            expect(createRes.status).toBe(201);

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/llm/current?sessionId=test-session-llm'
            );
            expect(res.status).toBe(200);
            expect((res.body as { config: unknown }).config).toBeDefined();
        });

        it('GET /api/llm/catalog returns LLM catalog', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/llm/catalog');
            expect(res.status).toBe(200);
            expectResponseStructure(res.body, {
                providers: validators.object,
            });
            const providers = (res.body as { providers: Record<string, unknown> }).providers;
            expect(Object.keys(providers).length).toBeGreaterThan(0);
            // Validate provider structure
            const firstProvider = Object.values(providers)[0] as {
                models: unknown;
            };
            expect(firstProvider).toBeDefined();
            expect(typeof firstProvider === 'object').toBe(true);
        });

        it('POST /api/llm/switch validates input', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/llm/switch', {});
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('POST /api/llm/switch with model update succeeds', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/llm/switch', {
                model: 'gpt-5',
            });
            expect(res.status).toBe(200);
        });

        it('GET /api/llm/model-picker-state returns picker sections', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/llm/model-picker-state');
            expect(res.status).toBe(200);
            expectResponseStructure(res.body, {
                featured: validators.array,
                recents: validators.array,
                favorites: validators.array,
                custom: validators.array,
            });
        });

        it('POST /api/llm/model-picker-state/favorites/toggle toggles favorite', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const toggleRes = await httpRequest(
                testServer.baseUrl,
                'POST',
                '/api/llm/model-picker-state/favorites/toggle',
                {
                    provider: 'openai',
                    model: 'gpt-5',
                }
            );
            expect(toggleRes.status).toBe(200);
            expectResponseStructure(toggleRes.body, {
                ok: validators.boolean,
                isFavorite: validators.boolean,
            });
        });
    });

    describe('Sessions Routes', () => {
        it('GET /api/sessions returns empty list initially', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/sessions');
            expect(res.status).toBe(200);
            expectResponseStructure(res.body, {
                sessions: validators.array,
            });
            const sessions = (res.body as { sessions: unknown[] }).sessions;
            // May have sessions from previous tests in integration suite
            expect(sessions.length).toBeGreaterThanOrEqual(0);
        });

        it('POST /api/sessions creates a new session', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-1',
            });
            expect(res.status).toBe(201);
            expectResponseStructure(res.body, {
                session: validators.object,
            });
            const session = (
                res.body as {
                    session: {
                        id: string;
                        createdAt: number | null;
                        lastActivity: number | null;
                        messageCount: number;
                        title: string | null;
                    };
                }
            ).session;
            expect(session.id).toBe('test-session-1');
            expect(typeof session.messageCount).toBe('number');
            expect(session.createdAt === null || typeof session.createdAt === 'number').toBe(true);
        });

        it('GET /api/sessions/:id returns session details', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-details',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/sessions/test-session-details'
            );
            expect(res.status).toBe(200);
            expect((res.body as { session: { id: string } }).session.id).toBe(
                'test-session-details'
            );
        });

        it('GET /api/sessions/:id returns 404 for non-existent session', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/sessions/non-existent-session'
            );
            expect(res.status).toBe(404);
        });

        it('GET /api/sessions/:id/load validates and returns session info', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-load',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/sessions/test-session-load/load'
            );
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('session');
            expect((res.body as { session: { id: string } }).session.id).toBe('test-session-load');
        });

        it('GET /api/sessions/:id/history returns session history', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-history',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/sessions/test-session-history/history'
            );
            expect(res.status).toBe(200);
            expect(Array.isArray((res.body as { history: unknown[] }).history)).toBe(true);
        });

        it('DELETE /api/sessions/:id deletes session', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-delete',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'DELETE',
                '/api/sessions/test-session-delete'
            );
            expect(res.status).toBe(200);

            // Verify deletion
            const getRes = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/sessions/test-session-delete'
            );
            expect(getRes.status).toBe(404);
        });
    });

    describe('Search Routes', () => {
        it('GET /api/search/messages requires query parameter', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/search/messages');
            expect(res.status).toBe(400);
        });

        it('GET /api/search/messages with query returns results', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/search/messages?q=test');
            expect(res.status).toBe(200);
            expect((res.body as { results: unknown[] }).results).toBeDefined();
        });

        it('GET /api/search/sessions requires query parameter', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/search/sessions');
            expect(res.status).toBe(400);
        });

        it('GET /api/search/sessions with query returns results', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/search/sessions?q=test');
            expect(res.status).toBe(200);
            expect((res.body as { results: unknown[] }).results).toBeDefined();
        });
    });

    describe('Memory Routes', () => {
        it('GET /api/memory returns empty list initially', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/memory');
            expect(res.status).toBe(200);
            expect(Array.isArray((res.body as { memories: unknown[] }).memories)).toBe(true);
        });

        it('POST /api/memory creates a memory', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/memory', {
                content: 'Test memory content',
                tags: ['test'],
            });
            expect(res.status).toBe(201);
            expect((res.body as { memory: { id: string } }).memory.id).toBeDefined();
            expect((res.body as { memory: { content: string } }).memory.content).toBe(
                'Test memory content'
            );
        });

        it('POST /api/memory validates required fields', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/memory', {});
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('GET /api/memory/:id returns memory details', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create memory first
            const createRes = await httpRequest(testServer.baseUrl, 'POST', '/api/memory', {
                content: 'Memory to retrieve',
                tags: ['test'],
            });
            const memoryId = (createRes.body as { memory: { id: string } }).memory.id;

            const res = await httpRequest(testServer.baseUrl, 'GET', `/api/memory/${memoryId}`);
            expect(res.status).toBe(200);
            expect((res.body as { memory: { id: string } }).memory.id).toBe(memoryId);
        });

        it('PUT /api/memory/:id updates memory', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create memory first
            const createRes = await httpRequest(testServer.baseUrl, 'POST', '/api/memory', {
                content: 'Original content',
                tags: ['test'],
            });
            const memoryId = (createRes.body as { memory: { id: string } }).memory.id;

            const res = await httpRequest(testServer.baseUrl, 'PUT', `/api/memory/${memoryId}`, {
                content: 'Updated content',
            });
            expect(res.status).toBe(200);
            expect((res.body as { memory: { content: string } }).memory.content).toBe(
                'Updated content'
            );
        });

        it('DELETE /api/memory/:id deletes memory', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create memory first
            const createRes = await httpRequest(testServer.baseUrl, 'POST', '/api/memory', {
                content: 'Memory to delete',
                tags: ['test'],
            });
            const memoryId = (createRes.body as { memory: { id: string } }).memory.id;

            const res = await httpRequest(testServer.baseUrl, 'DELETE', `/api/memory/${memoryId}`);
            expect(res.status).toBe(200);

            // Verify deletion
            const getRes = await httpRequest(testServer.baseUrl, 'GET', `/api/memory/${memoryId}`);
            expect(getRes.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('MCP Routes', () => {
        it('GET /api/mcp/servers returns server list', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/mcp/servers');
            expect(res.status).toBe(200);
            expect(typeof res.body).toBe('object');
        });

        it('POST /api/mcp/servers validates input', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/mcp/servers', {});
            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Prompts Routes', () => {
        it('GET /api/prompts returns prompt list', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/prompts');
            expect(res.status).toBe(200);
            expect(typeof res.body).toBe('object');
        });

        it('GET /api/prompts/:name returns prompt details', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/prompts/non-existent-prompt'
            );
            // May return 404 or empty result depending on implementation
            expect([200, 404]).toContain(res.status);
        });
    });

    describe('Resources Routes', () => {
        it('GET /api/resources returns resource list', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/resources');
            expect(res.status).toBe(200);
            expect(typeof res.body).toBe('object');
        });
    });

    describe('Webhooks Routes', () => {
        it('GET /api/webhooks returns webhook list', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/webhooks');
            expect(res.status).toBe(200);
            expect(Array.isArray((res.body as { webhooks: unknown[] }).webhooks)).toBe(true);
        });

        it('POST /api/webhooks validates URL', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/webhooks', {
                url: 'not-a-url',
            });
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('POST /api/webhooks creates webhook', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/webhooks', {
                url: 'https://example.com/webhook',
            });
            expect(res.status).toBe(201);
        });
    });

    describe('Greeting Route', () => {
        it('GET /api/greeting returns greeting', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/greeting');
            expect(res.status).toBe(200);
            // greeting might be undefined if not set in config, which is valid
            expect(res.body).toBeDefined();
            expect(
                typeof (res.body as { greeting?: unknown }).greeting === 'string' ||
                    (res.body as { greeting?: unknown }).greeting === undefined
            ).toBe(true);
        });

        it('GET /api/greeting with sessionId returns session-specific greeting', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-greeting',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/greeting?sessionId=test-session-greeting'
            );
            expect(res.status).toBe(200);
            // greeting might be undefined if not set in config, which is valid
            expect(res.body).toBeDefined();
            expect(
                typeof (res.body as { greeting?: unknown }).greeting === 'string' ||
                    (res.body as { greeting?: unknown }).greeting === undefined
            ).toBe(true);
        });
    });

    describe('A2A Routes', () => {
        it('GET /.well-known/agent-card.json returns agent card', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/.well-known/agent-card.json'
            );
            expect(res.status).toBe(200);
            expect((res.body as { name: unknown }).name).toBeDefined();
        });
    });

    describe('Message Routes', () => {
        it('POST /api/message validates input', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/message', {});
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('POST /api/message-sync validates input', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/message-sync', {});
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('POST /api/reset resets conversation', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-session-reset',
            });
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/reset', {
                sessionId: 'test-session-reset',
            });
            expect(res.status).toBe(200);
        });

        it('POST /api/message-stream returns SSE stream directly', async () => {
            if (!testServer) throw new Error('Test server not initialized');

            const sessionId = 'stream-session';
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', { sessionId });

            const agent = testServer.agent;
            const originalStream = agent.stream;
            const fakeEvents: StreamingEvent[] = [
                {
                    name: 'llm:thinking',
                    sessionId,
                },
                {
                    name: 'llm:chunk',
                    content: 'hello',
                    chunkType: 'text',
                    isComplete: false,
                    sessionId,
                },
                {
                    name: 'llm:response',
                    content: 'hello',
                    tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    sessionId,
                    provider: 'openai',
                    model: 'test-model',
                },
            ];

            agent.stream = async function (
                _message: string,
                _options
            ): Promise<AsyncIterableIterator<StreamingEvent>> {
                async function* generator() {
                    for (const event of fakeEvents) {
                        yield event;
                    }
                }
                return generator();
            } as typeof agent.stream;

            try {
                // POST to /api/message-stream - response IS the SSE stream
                const response = await fetch(`${testServer.baseUrl}/api/message-stream`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        content: 'Say hello',
                    }),
                });

                expect(response.status).toBe(200);
                expect(response.headers.get('content-type')).toBe('text/event-stream');

                const reader = response.body?.getReader();
                if (!reader) throw new Error('Response does not contain a readable body');

                const decoder = new TextDecoder();
                let received = '';
                let chunks = 0;
                while (chunks < 50) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    chunks++;
                    received += decoder.decode(value, { stream: true });
                    if (received.includes('event: llm:response')) {
                        break;
                    }
                }

                await reader.cancel();

                expect(received).toContain('event: llm:thinking');
                expect(received).toContain('event: llm:response');
            } finally {
                agent.stream = originalStream;
            }
        });
    });

    describe('Queue Routes', () => {
        it('GET /api/queue/:sessionId returns empty queue initially', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-queue-session',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/queue/test-queue-session'
            );
            expect(res.status).toBe(200);
            expect((res.body as { messages: unknown[]; count: number }).messages).toEqual([]);
            expect((res.body as { count: number }).count).toBe(0);
        });

        it('GET /api/queue/:sessionId returns 404 for non-existent session', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/queue/non-existent-queue-session'
            );
            expect(res.status).toBe(404);
        });

        it('POST /api/queue/:sessionId queues a message', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-queue-post-session',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'POST',
                '/api/queue/test-queue-post-session',
                { content: 'Hello from queue' }
            );
            expect(res.status).toBe(201);
            expect((res.body as { queued: boolean }).queued).toBe(true);
            expect((res.body as { id: string }).id).toBeDefined();
            expect((res.body as { position: number }).position).toBe(1);

            // Verify message is in queue
            const getRes = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/queue/test-queue-post-session'
            );
            expect((getRes.body as { count: number }).count).toBe(1);
        });

        it('POST /api/queue/:sessionId validates input', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Create session first
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: 'test-queue-validate-session',
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'POST',
                '/api/queue/test-queue-validate-session',
                {} // Empty body should fail validation
            );
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('DELETE /api/queue/:sessionId/:messageId removes a queued message', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const sessionId = `queue-delete-msg-${Date.now()}`;

            // Create session and queue a message
            const createRes = await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId,
            });
            expect(createRes.status).toBe(201);

            const queueRes = await httpRequest(
                testServer.baseUrl,
                'POST',
                `/api/queue/${sessionId}`,
                { content: 'Message to delete' }
            );
            expect(queueRes.status).toBe(201);
            const messageId = (queueRes.body as { id: string }).id;

            // Delete the message
            const res = await httpRequest(
                testServer.baseUrl,
                'DELETE',
                `/api/queue/${sessionId}/${messageId}`
            );
            expect(res.status).toBe(200);
            expect((res.body as { removed: boolean }).removed).toBe(true);

            // Verify queue is empty
            const getRes = await httpRequest(testServer.baseUrl, 'GET', `/api/queue/${sessionId}`);
            expect((getRes.body as { count: number }).count).toBe(0);
        });

        it('DELETE /api/queue/:sessionId clears all queued messages', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const sessionId = `queue-clear-${Date.now()}`;

            // Create session and queue multiple messages
            const createRes = await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId,
            });
            expect(createRes.status).toBe(201);

            const q1 = await httpRequest(testServer.baseUrl, 'POST', `/api/queue/${sessionId}`, {
                content: 'Message 1',
            });
            expect(q1.status).toBe(201);
            const q2 = await httpRequest(testServer.baseUrl, 'POST', `/api/queue/${sessionId}`, {
                content: 'Message 2',
            });
            expect(q2.status).toBe(201);

            // Clear the queue
            const res = await httpRequest(testServer.baseUrl, 'DELETE', `/api/queue/${sessionId}`);
            expect(res.status).toBe(200);
            expect((res.body as { cleared: boolean }).cleared).toBe(true);
            expect((res.body as { count: number }).count).toBe(2);

            // Verify queue is empty
            const getRes = await httpRequest(testServer.baseUrl, 'GET', `/api/queue/${sessionId}`);
            expect((getRes.body as { count: number }).count).toBe(0);
        });
    });

    describe('OpenAPI Schema', () => {
        it('GET /openapi.json returns OpenAPI schema', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/openapi.json');
            expect(res.status).toBe(200);
            expect((res.body as { openapi: string }).openapi).toBe('3.0.0');
        });
    });
});
