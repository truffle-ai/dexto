import request from 'supertest';
import { initializeApi } from '../../api/server.js';
import type { DextoAgent } from '@dexto/core';
import { AgentEventBus } from '@dexto/core';
import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

type SupportedRouter = 'vercel' | 'in-built';
type SupportedFileType = 'audio' | 'pdf';

// TOOD: Unify with API types later
interface CatalogModel {
    name: string;
    displayName?: string;
    default: boolean;
    maxInputTokens: number;
    supportedRouters?: SupportedRouter[];
    supportedFileTypes: SupportedFileType[];
}

interface CatalogProvider {
    name: string;
    hasApiKey: boolean;
    primaryEnvVar: string;
    supportedRouters: SupportedRouter[];
    supportsBaseURL: boolean;
    models: CatalogModel[];
}

interface CatalogGroupedResponse {
    providers: Record<string, CatalogProvider>;
}

interface CatalogFlatModel extends CatalogModel {
    provider: string;
}
interface CatalogFlatResponse {
    models: CatalogFlatModel[];
}

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
        listAgents: async () => ({ installed: [], available: [], current: { name: null } }),
        installAgent: async () => {},
        // Methods below are not exercised by these tests but are required by the server
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
        getEffectiveConfig: (_sessionId?: string) => ({
            llm: { provider: 'openai', model: 'gpt-4o', router: 'vercel' },
        }),
        getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-4o', router: 'vercel' }),
        getCurrentSessionId: () => null,
        switchLLM: async () => ({ provider: 'openai', model: 'gpt-4o', router: 'vercel' }),
        searchMessages: async () => ({ results: [] }),
        searchSessions: async () => ({ results: [] }),
        registerSubscriber: () => {},
        restart: async () => {},
    } as unknown as DextoAgent;
    return mockAgent;
}

describe('GET /api/llm/catalog', () => {
    let app: Express;
    let server: HttpServer | null = null;

    beforeAll(async () => {
        const mockAgent = makeMockAgent();
        const initialized = await initializeApi(mockAgent);
        app = initialized.app as Express;
        server = initialized.server as HttpServer;
    });

    afterAll(async () => {
        if (server && server.close) server.close();
    });

    it('returns grouped providers with displayName on models', async () => {
        const res = await request(app).get('/api/llm/catalog').expect(200);
        const body = res.body as CatalogGroupedResponse;
        const providers = body.providers;
        expect(providers).toBeDefined();
        // Expect OpenAI present and at least one model with displayName
        const openai = providers.openai as CatalogProvider;
        expect(openai).toBeDefined();
        expect(Array.isArray(openai.models)).toBe(true);
        const anyDisplay = openai.models.some((m) => typeof m.displayName === 'string');
        expect(anyDisplay).toBe(true);
    });

    it('provider filter includes only requested providers', async () => {
        const res = await request(app)
            .get('/api/llm/catalog?provider=openai,anthropic')
            .expect(200);
        const body = res.body as CatalogGroupedResponse;
        const keys = Object.keys(body.providers);
        expect(keys.every((k) => ['openai', 'anthropic'].includes(k))).toBe(true);
    });

    it('router filter keeps providers that support router and filters models accordingly', async () => {
        const res = await request(app).get('/api/llm/catalog?router=vercel').expect(200);
        const providers = (res.body as CatalogGroupedResponse).providers;
        for (const v of Object.values(providers)) {
            expect(v.supportedRouters).toContain('vercel');
            // Every model either has supportedRouters including vercel or no model-level override
            const ok = v.models.every(
                (m) => !m.supportedRouters || m.supportedRouters.includes('vercel')
            );
            expect(ok).toBe(true);
        }
    });

    it('fileType filter returns only models supporting the file type', async () => {
        const res = await request(app).get('/api/llm/catalog?fileType=audio').expect(200);
        const providers = (res.body as CatalogGroupedResponse).providers;
        for (const v of Object.values(providers)) {
            expect(v.models.length).toBeGreaterThan(0);
            const ok = v.models.every((m) => (m.supportedFileTypes || []).includes('audio'));
            expect(ok).toBe(true);
        }
    });

    it('defaultOnly=true returns only default models', async () => {
        const res = await request(app).get('/api/llm/catalog?defaultOnly=true').expect(200);
        const providers = (res.body as CatalogGroupedResponse).providers;
        for (const v of Object.values(providers)) {
            const ok = v.models.every((m) => m.default === true);
            expect(ok).toBe(true);
        }
    });

    it('mode=flat returns models with provider and displayName', async () => {
        const res = await request(app).get('/api/llm/catalog?mode=flat').expect(200);
        const models = (res.body as CatalogFlatResponse).models;
        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBeGreaterThan(0);
        // Check typical shape
        const first = models[0];
        expect(first).toHaveProperty('provider');
        // displayName should be present for known slugs
        const anyDisplay = models.some((m) => typeof m.displayName === 'string');
        expect(anyDisplay).toBe(true);
    });

    describe('hasKey filter reflects environment', () => {
        const ORIGINAL_ENV = { ...process.env };
        const PROVIDER_ENV_KEYS = [
            'OPENAI_API_KEY',
            'OPENAI_KEY',
            'ANTHROPIC_API_KEY',
            'ANTHROPIC_KEY',
            'CLAUDE_API_KEY',
            'GOOGLE_GENERATIVE_AI_API_KEY',
            'GOOGLE_API_KEY',
            'GEMINI_API_KEY',
            'GROQ_API_KEY',
            'COHERE_API_KEY',
            'XAI_API_KEY',
            'X_AI_API_KEY',
            // Include OpenRouter to ensure a clean environment when filtering by hasKey
            'OPENROUTER_API_KEY',
        ] as const;
        const clearProviderEnv = () => {
            for (const k of PROVIDER_ENV_KEYS)
                delete (process.env as Record<string, string | undefined>)[k];
        };
        afterEach(() => {
            process.env = { ...ORIGINAL_ENV };
        });

        it('hasKey=true excludes providers without env var', async () => {
            clearProviderEnv();
            const res = await request(app).get('/api/llm/catalog?hasKey=true').expect(200);
            const providers = (res.body as CatalogGroupedResponse).providers;
            expect(Object.keys(providers).length).toBe(0);
        });

        it('hasKey=true includes providers with env var set', async () => {
            clearProviderEnv();
            process.env.OPENAI_API_KEY = 'test-key';
            const res = await request(app).get('/api/llm/catalog?hasKey=true').expect(200);
            const providers = (res.body as CatalogGroupedResponse).providers;
            const openai = providers.openai as CatalogProvider;
            expect(openai).toBeDefined();
            expect(openai.hasApiKey).toBe(true);
        });
    });
});
