import request from 'supertest';
import { initializeApi } from '../../api/server.js';
import type { DextoAgent } from '@dexto/core';
import { AgentEventBus } from '@dexto/core';
import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('GET /api/llm/current', () => {
    let app: Express;
    let server: HttpServer | null = null;

    function makeMockAgent(): DextoAgent {
        const agentEventBus = new AgentEventBus();
        const mockAgent = {
            agentEventBus,
            stop: async () => {},
            // Lifecycle methods required by server initialization
            isStarted: () => true,
            isStopped: () => false,
            start: async () => {},
            // Agent management methods required by server
            listAgents: async () => ({
                installed: [],
                available: [],
                current: { id: null, name: null },
            }),
            installAgent: async () => {},
            getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-5', router: 'vercel' }),
            getEffectiveConfig: (sessionId?: string) => ({
                llm:
                    sessionId === 'abc'
                        ? {
                              provider: 'anthropic',
                              model: 'claude-4-sonnet-20250514',
                              router: 'in-built',
                          }
                        : { provider: 'openai', model: 'gpt-5', router: 'vercel' },
            }),
            // Stubs for endpoints the server wires (not used by these tests)
            run: async () => ({}),
            resetConversation: async () => {},
            listSessions: async () => [],
            createSession: async (id?: string) => ({ id: id ?? 'test-session' }),
            getSessionMetadata: async () => ({
                createdAt: Date.now(),
                lastActivity: Date.now(),
                messageCount: 0,
            }),
            getSessionHistory: async () => [],
            getCurrentSessionId: () => null,
            switchLLM: async () => ({ provider: 'openai', model: 'gpt-5', router: 'vercel' }),
            searchMessages: async () => ({ results: [] }),
            searchSessions: async () => ({ results: [] }),
            registerSubscriber: () => {},
            restart: async () => {},
        } as unknown as DextoAgent;
        return mockAgent;
    }

    beforeAll(async () => {
        const { app: expressApp, server: httpServer } = await initializeApi(makeMockAgent());
        app = expressApp as Express;
        server = httpServer as HttpServer;
    });

    afterAll(async () => {
        if (server && server.close) server.close();
    });

    it('returns displayName for default config', async () => {
        const res = await request(app).get('/api/llm/current').expect(200);
        const config = res.body.config as { provider: string; model: string; displayName?: string };
        expect(config.provider).toBe('openai');
        expect(config.model).toBe('gpt-5');
        expect(typeof config.displayName === 'string').toBe(true);
    });

    it('returns displayName for session config', async () => {
        const res = await request(app).get('/api/llm/current?sessionId=abc').expect(200);
        const config = res.body.config as { provider: string; model: string; displayName?: string };
        expect(config.provider).toBe('anthropic');
        expect(config.model).toBe('claude-4-sonnet-20250514');
        expect(typeof config.displayName === 'string').toBe(true);
    });
});
