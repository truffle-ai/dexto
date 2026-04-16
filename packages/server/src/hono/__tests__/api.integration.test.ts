import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TextDecoder } from 'node:util';
import type { StreamingEvent } from '@dexto/core';
import { ApprovalType } from '@dexto/core';
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

        it('GET /api/llm/capabilities returns reasoning support', async () => {
            if (!testServer) throw new Error('Test server not initialized');

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/llm/capabilities?provider=anthropic&model=claude-3-7-sonnet-20250219'
            );
            expect(res.status).toBe(200);
            expectResponseStructure(res.body, {
                provider: validators.string,
                model: validators.string,
                supportedFileTypes: validators.array,
                reasoning: validators.object,
            });

            const reasoning = (res.body as { reasoning: unknown }).reasoning as {
                capable: boolean;
                paradigm: string;
                supportedVariants: string[];
                defaultVariant?: string;
                supportsBudgetTokens: boolean;
            };

            expect(reasoning.capable).toBe(true);
            expect(reasoning.paradigm).toBe('budget');
            expect(reasoning.supportedVariants).toContain('enabled');
            expect(reasoning.supportedVariants).toContain('disabled');
            expect(reasoning.defaultVariant).toBe('enabled');
            expect(reasoning.supportsBudgetTokens).toBe(true);
        });

        it('GET /api/llm/capabilities resolves gateway providers for OpenRouter-format IDs', async () => {
            if (!testServer) throw new Error('Test server not initialized');

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                '/api/llm/capabilities?provider=dexto-nova&model=openai/gpt-5.2-codex'
            );
            expect(res.status).toBe(200);

            const reasoning = (res.body as { reasoning: unknown }).reasoning as {
                capable: boolean;
                supportedVariants: string[];
            };

            expect(reasoning.capable).toBe(true);
            expect(reasoning.supportedVariants).toContain('high');
            expect(reasoning.supportedVariants).not.toContain('max');
            expect(reasoning.supportedVariants).toContain('xhigh');
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
                        parentSessionId: string | null;
                    };
                }
            ).session;
            expect(session.id).toBe('test-session-1');
            expect(typeof session.messageCount).toBe('number');
            expect(session.createdAt === null || typeof session.createdAt === 'number').toBe(true);
            expect(session.parentSessionId).toBeNull();
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

        it('GET /api/sessions/:id passes through usage metadata from core', async () => {
            if (!testServer) throw new Error('Test server not initialized');

            const sessionId = 'test-session-usage';
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', { sessionId });

            const agent = testServer.agent;
            const originalGetSessionMetadata = agent.getSessionMetadata.bind(agent);
            const getSessionMetadataSpy = vi
                .spyOn(agent, 'getSessionMetadata')
                .mockImplementation(async (requestedSessionId) => {
                    if (requestedSessionId !== sessionId) {
                        return originalGetSessionMetadata(requestedSessionId);
                    }

                    return {
                        createdAt: 1000,
                        lastActivity: 2000,
                        messageCount: 3,
                        title: 'Usage session',
                        tokenUsage: {
                            inputTokens: 100,
                            outputTokens: 50,
                            reasoningTokens: 10,
                            cacheReadTokens: 25,
                            cacheWriteTokens: 5,
                            totalTokens: 190,
                        },
                        estimatedCost: 0.0123,
                        modelStats: [
                            {
                                provider: 'openai',
                                model: 'gpt-4o-mini',
                                messageCount: 2,
                                tokenUsage: {
                                    inputTokens: 100,
                                    outputTokens: 50,
                                    reasoningTokens: 10,
                                    cacheReadTokens: 25,
                                    cacheWriteTokens: 5,
                                    totalTokens: 190,
                                },
                                estimatedCost: 0.0123,
                                firstUsedAt: 1000,
                                lastUsedAt: 2000,
                            },
                        ],
                        usageTracking: {
                            hasUntrackedChatGPTLoginUsage: true,
                        },
                    };
                });

            try {
                const res = await httpRequest(
                    testServer.baseUrl,
                    'GET',
                    `/api/sessions/${sessionId}`
                );

                expect(res.status).toBe(200);
                expect((res.body as { session: unknown }).session).toMatchObject({
                    id: sessionId,
                    tokenUsage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        reasoningTokens: 10,
                        cacheReadTokens: 25,
                        cacheWriteTokens: 5,
                        totalTokens: 190,
                    },
                    estimatedCost: 0.0123,
                    modelStats: [
                        {
                            provider: 'openai',
                            model: 'gpt-4o-mini',
                            messageCount: 2,
                            estimatedCost: 0.0123,
                        },
                    ],
                    usageTracking: {
                        hasUntrackedChatGPTLoginUsage: true,
                    },
                });
            } finally {
                getSessionMetadataSpy.mockRestore();
            }
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

        it('GET /api/sessions/:id/load returns exact usage summary for the active usage scope', async () => {
            const scopedAgent = await createTestAgent(undefined, {
                runtimeOverrides: { usageScopeId: 'cloud-agent-1' },
            });
            const scopedServer = await startTestServer(scopedAgent);
            try {
                await httpRequest(scopedServer.baseUrl, 'POST', '/api/sessions', {
                    sessionId: 'test-session-load-scoped',
                });

                const usageSpy = vi
                    .spyOn(scopedServer.agent, 'getSessionUsageSummary')
                    .mockResolvedValueOnce({
                        tokenUsage: {
                            inputTokens: 15,
                            outputTokens: 7,
                            reasoningTokens: 2,
                            cacheReadTokens: 1,
                            cacheWriteTokens: 0,
                            totalTokens: 25,
                        },
                        estimatedCost: 0.005,
                        hasUnpricedResponses: false,
                    })
                    .mockResolvedValueOnce({
                        tokenUsage: {
                            inputTokens: 11,
                            outputTokens: 5,
                            reasoningTokens: 0,
                            cacheReadTokens: 1,
                            cacheWriteTokens: 0,
                            totalTokens: 17,
                        },
                        estimatedCost: 0.003,
                        hasUnpricedResponses: false,
                    });

                try {
                    const res = await httpRequest(
                        scopedServer.baseUrl,
                        'GET',
                        '/api/sessions/test-session-load-scoped/load'
                    );

                    expect(res.status).toBe(200);
                    expect(res.body).toMatchObject({
                        session: {
                            id: 'test-session-load-scoped',
                            activeUsageScopeId: 'cloud-agent-1',
                            usageSummary: {
                                tokenUsage: {
                                    inputTokens: 15,
                                    outputTokens: 7,
                                    reasoningTokens: 2,
                                    cacheReadTokens: 1,
                                    cacheWriteTokens: 0,
                                    totalTokens: 25,
                                },
                                estimatedCost: 0.005,
                                hasUnpricedResponses: false,
                            },
                            activeUsageScope: {
                                scopeId: 'cloud-agent-1',
                                tokenUsage: {
                                    inputTokens: 11,
                                    outputTokens: 5,
                                    reasoningTokens: 0,
                                    cacheReadTokens: 1,
                                    cacheWriteTokens: 0,
                                    totalTokens: 17,
                                },
                                estimatedCost: 0.003,
                                hasUnpricedResponses: false,
                            },
                        },
                    });
                    expect(usageSpy).toHaveBeenNthCalledWith(1, 'test-session-load-scoped');
                    expect(usageSpy).toHaveBeenNthCalledWith(
                        2,
                        'test-session-load-scoped',
                        'cloud-agent-1'
                    );
                } finally {
                    usageSpy.mockRestore();
                }
            } finally {
                await scopedServer.cleanup();
            }
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

        it('GET /api/sessions/:id/history preserves resource parts for media rehydration', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const sessionId = 'test-session-history-resource-parts';

            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId,
            });

            const database = testServer.agent.services.storageManager.getDatabase();
            await database.append(`messages:${sessionId}`, {
                role: 'tool',
                toolCallId: 'call-resource-history',
                name: 'read_media_file',
                success: true,
                content: [
                    { type: 'text', text: 'Loaded local video resource.' },
                    {
                        type: 'resource',
                        uri: '/tmp/demo-video.mp4',
                        name: 'demo-video.mp4',
                        mimeType: 'video/mp4',
                        kind: 'video',
                        metadata: {
                            originalPath: '/tmp/demo-video.mp4',
                            mtimeMs: 1234.5,
                            source: 'filesystem',
                        },
                    },
                ],
            });

            const sessionData = await database.get<
                { messageCount: number } & Record<string, unknown>
            >(`session:${sessionId}`);
            if (!sessionData) {
                throw new Error(`Expected session '${sessionId}' to exist`);
            }
            sessionData.messageCount = 1;
            await database.set(`session:${sessionId}`, sessionData);
            await testServer.agent.endSession(sessionId);

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                `/api/sessions/${sessionId}/history`
            );

            expect(res.status).toBe(200);
            const history = (res.body as { history: Array<{ content: unknown[] }> }).history;
            expect(history).toHaveLength(1);
            expect(history[0]?.content[1]).toEqual({
                type: 'resource',
                uri: '/tmp/demo-video.mp4',
                name: 'demo-video.mp4',
                mimeType: 'video/mp4',
                kind: 'video',
                metadata: {
                    mtimeMs: 1234.5,
                    source: 'filesystem',
                },
            });
        });

        it('GET /api/sessions/:id/history expands blob-backed media parts by default', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const sessionId = 'test-session-history-expanded-blobs';

            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId,
            });

            const blobStore = testServer.agent.services.storageManager.getBlobStore();
            const storedBlob = await blobStore.store('iVBORw0KGgo=', {
                mimeType: 'image/png',
                originalName: 'demo-image.png',
                source: 'tool',
            });

            const database = testServer.agent.services.storageManager.getDatabase();
            await database.append(`messages:${sessionId}`, {
                role: 'tool',
                toolCallId: 'call-history-blob',
                name: 'read_media_file',
                success: true,
                content: [
                    {
                        type: 'image',
                        image: `@${storedBlob.uri}`,
                        mimeType: 'image/png',
                    },
                ],
            });

            const sessionData = await database.get<
                { messageCount: number } & Record<string, unknown>
            >(`session:${sessionId}`);
            if (!sessionData) {
                throw new Error(`Expected session '${sessionId}' to exist`);
            }
            sessionData.messageCount = 1;
            await database.set(`session:${sessionId}`, sessionData);

            const res = await httpRequest(
                testServer.baseUrl,
                'GET',
                `/api/sessions/${sessionId}/history`
            );

            expect(res.status).toBe(200);
            const history = (res.body as { history: Array<{ content: unknown[] }> }).history;
            expect(history).toHaveLength(1);
            expect(history[0]?.content[0]).toEqual({
                type: 'image',
                image: 'iVBORw0KGgo=',
                mimeType: 'image/png',
            });
        });

        it('GET /api/sessions/:id/history preserves blob refs when API expansion fails', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const sessionId = 'test-session-history-failed-blob-expansion';

            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId,
            });

            const database = testServer.agent.services.storageManager.getDatabase();
            await database.append(`messages:${sessionId}`, {
                role: 'tool',
                toolCallId: 'call-history-missing-blob',
                name: 'read_media_file',
                success: true,
                content: [
                    {
                        type: 'file',
                        data: '@blob:missing-history-blob',
                        mimeType: 'application/pdf',
                        filename: 'missing.pdf',
                    },
                ],
            });

            const sessionData = await database.get<
                { messageCount: number } & Record<string, unknown>
            >(`session:${sessionId}`);
            if (!sessionData) {
                throw new Error(`Expected session '${sessionId}' to exist`);
            }
            sessionData.messageCount = 1;
            await database.set(`session:${sessionId}`, sessionData);

            const readSpy = vi
                .spyOn(testServer.agent.resourceManager, 'read')
                .mockRejectedValueOnce(new Error('blob missing'));

            try {
                const res = await httpRequest(
                    testServer.baseUrl,
                    'GET',
                    `/api/sessions/${sessionId}/history`
                );

                expect(res.status).toBe(200);
                const history = (res.body as { history: Array<{ content: unknown[] }> }).history;
                expect(history).toHaveLength(1);
                expect(history[0]?.content[0]).toEqual({
                    type: 'file',
                    data: '@blob:missing-history-blob',
                    mimeType: 'application/pdf',
                    filename: 'missing.pdf',
                });
                expect(readSpy).toHaveBeenCalledTimes(1);
            } finally {
                readSpy.mockRestore();
            }
        });

        it('POST /api/sessions/:id/fork creates child with parentSessionId', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const parentSessionId = 'test-fork-parent';

            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: parentSessionId,
            });

            const res = await httpRequest(
                testServer.baseUrl,
                'POST',
                `/api/sessions/${parentSessionId}/fork`
            );

            expect(res.status).toBe(201);
            const child = (
                res.body as {
                    session: {
                        id: string;
                        title: string | null;
                        parentSessionId: string | null;
                    };
                }
            ).session;
            expect(child.id).toBeDefined();
            expect(child.id).not.toBe(parentSessionId);
            expect(child.parentSessionId).toBe(parentSessionId);
            expect(child.title).toBe('Fork: test-for');
        });

        it('POST /api/sessions/:id/fork clones persisted parent history', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const parentSessionId = 'test-fork-history-parent';

            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', {
                sessionId: parentSessionId,
            });

            const parentHistory = [
                { role: 'user', content: 'fork me 1' },
                { role: 'assistant', content: 'forked 1' },
                { role: 'user', content: 'fork me 2' },
            ];

            const database = testServer.agent.services.storageManager.getDatabase();
            for (const message of parentHistory) {
                await database.append(`messages:${parentSessionId}`, message);
            }
            const parentSessionData = await database.get<
                { messageCount: number } & Record<string, unknown>
            >(`session:${parentSessionId}`);
            if (!parentSessionData) {
                throw new Error(`Expected parent session '${parentSessionId}' to exist`);
            }
            parentSessionData.messageCount = parentHistory.length;
            await database.set(`session:${parentSessionId}`, parentSessionData);

            const forkRes = await httpRequest(
                testServer.baseUrl,
                'POST',
                `/api/sessions/${parentSessionId}/fork`
            );
            expect(forkRes.status).toBe(201);
            const childSessionId = (forkRes.body as { session: { id: string } }).session.id;

            const childHistory = await testServer.agent.services.storageManager
                .getDatabase()
                .getRange<
                    (typeof parentHistory)[number]
                >(`messages:${childSessionId}`, 0, parentHistory.length);
            expect(childHistory).toEqual(parentHistory);

            const childDetailsRes = await httpRequest(
                testServer.baseUrl,
                'GET',
                `/api/sessions/${childSessionId}`
            );
            expect(childDetailsRes.status).toBe(200);
            expect(
                (childDetailsRes.body as { session: { messageCount: number } }).session.messageCount
            ).toBe(parentHistory.length);
        });

        it('POST /api/sessions/:id/fork returns 404 for non-existent parent', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(
                testServer.baseUrl,
                'POST',
                '/api/sessions/non-existent-parent/fork'
            );
            expect(res.status).toBe(404);
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

        it('POST /api/message-sync returns canonical response usage metadata', async () => {
            if (!testServer) throw new Error('Test server not initialized');

            const agent = testServer.agent;
            const generateSpy = vi.spyOn(agent, 'generate').mockResolvedValue({
                content: 'Hello world',
                reasoning: 'Let me think',
                usage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    reasoningTokens: 10,
                    cacheReadTokens: 25,
                    cacheWriteTokens: 5,
                    totalTokens: 190,
                },
                toolCalls: [],
                sessionId: 'sync-session',
                messageId: '4a2d8f95-7d84-4898-9d0e-77d2496d6b8d',
                usageScopeId: 'cloud-agent-1',
                provider: 'openai',
                model: 'gpt-4o-mini',
                estimatedCost: 0.0123,
                pricingStatus: 'estimated',
                hostRuntime: {
                    ids: {
                        runId: 'run-1',
                        attemptId: 'attempt-1',
                    },
                },
            });

            try {
                const res = await httpRequest(testServer.baseUrl, 'POST', '/api/message-sync', {
                    sessionId: 'sync-session',
                    content: 'Say hello',
                });

                expect(res.status).toBe(200);
                expect(res.body).toMatchObject({
                    response: 'Hello world',
                    sessionId: 'sync-session',
                    messageId: '4a2d8f95-7d84-4898-9d0e-77d2496d6b8d',
                    usageScopeId: 'cloud-agent-1',
                    estimatedCost: 0.0123,
                    pricingStatus: 'estimated',
                    reasoning: 'Let me think',
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    hostRuntime: {
                        ids: {
                            runId: 'run-1',
                            attemptId: 'attempt-1',
                        },
                    },
                    tokenUsage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        reasoningTokens: 10,
                        cacheReadTokens: 25,
                        cacheWriteTokens: 5,
                        totalTokens: 190,
                    },
                });
            } finally {
                generateSpy.mockRestore();
            }
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
                    messageId: '4a2d8f95-7d84-4898-9d0e-77d2496d6b8d',
                    usageScopeId: 'cloud-agent-1',
                    estimatedCost: 0.0001,
                    pricingStatus: 'estimated',
                    provider: 'openai',
                    model: 'test-model',
                },
            ];

            agent.stream = async function (
                this: typeof agent,
                _message: string,
                _options
            ): Promise<AsyncIterableIterator<StreamingEvent>> {
                expect(this).toBe(agent);
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
                expect(received).toContain('"messageId":"4a2d8f95-7d84-4898-9d0e-77d2496d6b8d"');
                expect(received).toContain('"usageScopeId":"cloud-agent-1"');
                expect(received).toContain('"estimatedCost":0.0001');
                expect(received).toContain('"pricingStatus":"estimated"');
            } finally {
                agent.stream = originalStream;
            }
        });

        it('POST /api/message-stream forwards approval requests without waiting for later stream events', async () => {
            if (!testServer) throw new Error('Test server not initialized');

            const sessionId = 'stream-session-approval-live';
            const agent = testServer.agent;
            const originalStream = agent.stream;

            const approvalRequest: StreamingEvent = {
                name: 'approval:request',
                approvalId: 'approval-live-1',
                sessionId,
                type: ApprovalType.DIRECTORY_ACCESS,
                timestamp: new Date(),
                timeout: 120000,
                metadata: {
                    toolName: 'read_media_file',
                    path: '/tmp/test.png',
                    parentDir: '/tmp',
                    operation: 'read',
                },
            };

            agent.stream = async function (
                this: typeof agent,
                _message: string,
                _sessionId: string,
                _options
            ): Promise<AsyncIterableIterator<StreamingEvent>> {
                expect(this).toBe(agent);
                let emitted = false;
                const iterator: AsyncIterableIterator<StreamingEvent> = {
                    [Symbol.asyncIterator]() {
                        return iterator;
                    },
                    async next() {
                        if (!emitted) {
                            emitted = true;
                            return { done: false, value: approvalRequest };
                        }
                        return { done: true, value: undefined };
                    },
                };
                return iterator;
            } as typeof agent.stream;

            try {
                await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', { sessionId });

                const response = await fetch(`${testServer.baseUrl}/api/message-stream`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        content: 'Inspect this image',
                    }),
                });

                expect(response.status).toBe(200);
                expect(response.headers.get('content-type')).toBe('text/event-stream');

                const streamed = await response.text();
                expect(streamed).toContain('event: approval:request');
                expect(streamed).toContain('"approvalId":"approval-live-1"');
                expect(streamed).toContain('"toolName":"read_media_file"');
            } finally {
                agent.stream = originalStream;
            }
        });

        it('POST /api/message-stream aborts the disconnect signal when the client disconnects', async () => {
            if (!testServer) throw new Error('Test server not initialized');

            const sessionId = 'stream-session-disconnect';
            await httpRequest(testServer.baseUrl, 'POST', '/api/sessions', { sessionId });

            const agent = testServer.agent;
            const originalStream = agent.stream;
            let disconnectSignal: AbortSignal | undefined;

            agent.stream = async function (
                this: typeof agent,
                _message: string,
                _sessionId: string,
                options?: Parameters<typeof agent.stream>[2] & { disconnectSignal?: AbortSignal }
            ): Promise<AsyncIterableIterator<StreamingEvent>> {
                expect(this).toBe(agent);
                disconnectSignal = options?.disconnectSignal;

                let emitted = false;
                const iterator: AsyncIterableIterator<StreamingEvent> = {
                    [Symbol.asyncIterator]() {
                        return iterator;
                    },
                    async next() {
                        if (!emitted) {
                            emitted = true;
                            return {
                                done: false,
                                value: {
                                    name: 'llm:thinking',
                                    sessionId,
                                },
                            };
                        }

                        await new Promise<void>((resolve) => {
                            disconnectSignal?.addEventListener('abort', () => resolve(), {
                                once: true,
                            });
                        });
                        return { done: true, value: undefined };
                    },
                };
                return iterator;
            } as typeof agent.stream;

            try {
                const requestAbortController = new AbortController();
                const response = await fetch(`${testServer.baseUrl}/api/message-stream`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: requestAbortController.signal,
                    body: JSON.stringify({
                        sessionId,
                        content: 'Stay open until disconnect',
                    }),
                });

                expect(response.status).toBe(200);
                const reader = response.body?.getReader();
                if (!reader) throw new Error('Response does not contain a readable body');

                await reader.read();
                requestAbortController.abort();

                await vi.waitFor(() => {
                    expect(disconnectSignal?.aborted).toBe(true);
                });
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
